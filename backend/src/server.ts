import { env } from './config/env';
import app from './app';
import { startJobs } from './jobs';

app.listen(env.port, () => {
  console.log(`\n  NEXORA HRMS API  ->  http://localhost:${env.port}/api/health\n`);
  startJobs();
});
