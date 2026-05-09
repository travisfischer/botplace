// Load `.env` so DB-touching tests see DATABASE_URL the same way Next.js
// does. CI / process-env values win over `.env` (dotenv default behavior).

import { config } from "dotenv";

config({ quiet: true });
