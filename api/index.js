// Vercel serverless entry: every /api/* request goes through one router.
import { handle } from '../server/routes.js';
export default handle;
