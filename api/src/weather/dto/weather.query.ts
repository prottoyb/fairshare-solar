import { IsISO8601, Matches } from 'class-validator';

/** Same rules as the summary's date (SPEC.md §5.7), as a Melbourne local date. */
export class WeatherQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a local date in YYYY-MM-DD format',
  })
  @IsISO8601({ strict: true }, { message: 'date must be a real calendar date' })
  date!: string;
}
