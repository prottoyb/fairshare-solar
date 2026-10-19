import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { DeviceStatusService } from './device-status.service';
import { LiveEventsService } from './live-events.service';

/** The part of a Socket.IO server or socket this gateway uses. */
type Emitter = { emit(event: string, ...args: unknown[]): unknown };

/**
 * Socket.IO on the default namespace and the API's port (brief §5.8).
 * `reading` after each committed interval (never replays); `device-status` on
 * change, and the current status to each client as it connects.
 */
@WebSocketGateway({ cors: { origin: 'http://localhost:5173' } })
export class LiveGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  // Not set in a plain application context (e.g. the seed), hence optional.
  @WebSocketServer()
  server?: Emitter;

  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly live: LiveEventsService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.live.readings$.subscribe((e) =>
        this.server?.emit('reading', e.reading),
      ),
      this.live.deviceStatus$.subscribe((status) =>
        this.server?.emit('device-status', status),
      ),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subscriptions) s.unsubscribe();
    this.subscriptions.length = 0;
  }

  handleConnection(client: Emitter): void {
    for (const status of this.deviceStatus.snapshot()) {
      client.emit('device-status', status);
    }
  }
}
