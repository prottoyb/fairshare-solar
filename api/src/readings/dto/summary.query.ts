import { IsISO8601, Matches } from 'class-validator';

export class SummaryQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a UTC date in YYYY-MM-DD format',
  })
  @IsISO8601({ strict: true }, { message: 'date must be a real calendar date' })
  date!: string;
}
