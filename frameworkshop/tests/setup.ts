/**
 * Integration tests truncate every table, so they must never run against the
 * development database that holds the demo data. TEST_DATABASE_URL redirects
 * them to a throwaway database.
 */

import 'dotenv/config';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
