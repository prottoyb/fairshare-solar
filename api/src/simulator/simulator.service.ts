import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INTERVAL_MINUTES } from '../common/limits';
import { addMinutes, startOfUtcDay } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { ReadingsService } from '../readings/readings.service';
import { ReadingGenerator } from './reading-generator';
import {
  DEFAULT_SIM_SEED,
  DEFAULT_SPEED_MS,
  SIM_DEVICE_ID,
} from './simulator.constants';

export type SimulatorStatus = {
  running: boolean;
  speedMs: number;
  buildingId: string | null;
  /** Start of the next interval the simulator will send (UTC), once known. */
  simulatedTime: string | null;
};

/**
 * Sends one simulated 5-minute interval every `speedMs` real milliseconds through
 * ReadingsService.ingest(), the same path as HTTP (ADR-004). Plain setInterval,
 * cleared on stop and in onModuleDestroy; a tick is skipped while the previous
 * ingest is still running.
 */
@Injectable()
export class SimulatorService implements OnModuleDestroy {
  private readonly logger = new Logger(SimulatorService.name);
  private readonly seed: number;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private currentSpeedMs = DEFAULT_SPEED_MS;
  private buildingId: string | null = null;
  private clock: Date | null = null;
  private generator: ReadingGenerator | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly readings: ReadingsService,
    config: ConfigService,
  ) {
    const seed = Number(config.get<string>('SIM_SEED'));
    this.seed = Number.isInteger(seed) ? seed : DEFAULT_SIM_SEED;
  }

  get speedMs(): number {
    return this.currentSpeedMs;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Starts, or restarts at a new speed. The same speed while running does nothing. */
  async start(speedMs = DEFAULT_SPEED_MS): Promise<SimulatorStatus> {
    if (this.running && speedMs === this.currentSpeedMs) return this.status();
    if (!this.running) await this.prepare();

    this.clearTimer();
    this.currentSpeedMs = speedMs;
    this.timer = setInterval(() => void this.tick(), speedMs);
    this.logger.log(
      `Started at ${speedMs} ms per interval from ${this.clock?.toISOString()}`,
    );
    return this.status();
  }

  async stop(): Promise<SimulatorStatus> {
    if (this.running) this.logger.log('Stopped');
    this.clearTimer();
    return this.status();
  }

  async status(): Promise<SimulatorStatus> {
    if (!this.buildingId) {
      const building = await this.prisma.building.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      this.buildingId = building?.id ?? null;
    }
    return {
      running: this.running,
      speedMs: this.currentSpeedMs,
      buildingId: this.buildingId,
      simulatedTime: this.clock?.toISOString() ?? null,
    };
  }

  onModuleDestroy(): void {
    this.clearTimer();
  }

  /**
   * Finds the building and sets the simulated clock to the interval after the
   * device's latest stored reading, or today 00:00 UTC, so a restart never 409s.
   */
  private async prepare(): Promise<void> {
    const building = await this.prisma.building.findFirst({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        capacityW: true,
        apartments: { select: { id: true }, orderBy: { label: 'asc' } },
      },
    });
    if (!building) {
      throw new NotFoundException(
        'No building to simulate. Run the seed first (npm run db:seed).',
      );
    }
    if (this.buildingId !== building.id || !this.generator) {
      this.generator = new ReadingGenerator(
        this.seed,
        building.apartments.map((a) => a.id),
        building.capacityW,
        SIM_DEVICE_ID,
      );
    }
    this.buildingId = building.id;

    const latest = await this.prisma.reading.findFirst({
      where: { deviceId: SIM_DEVICE_ID },
      orderBy: { intervalStart: 'desc' },
      select: { intervalStart: true },
    });
    this.clock = latest
      ? addMinutes(latest.intervalStart, INTERVAL_MINUTES)
      : startOfUtcDay(new Date());
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.clock || !this.generator || !this.buildingId) return;
    this.busy = true;
    const at = this.clock;
    try {
      await this.readings.ingest(this.buildingId, this.generator.next(at));
    } catch (err) {
      // Never let one bad interval stop the timer.
      this.logger.warn(
        `Interval ${at.toISOString()} failed: ${(err as Error).message}`,
      );
    } finally {
      this.clock = addMinutes(at, INTERVAL_MINUTES);
      this.busy = false;
    }
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
