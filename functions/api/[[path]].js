// Cloudflare Pages Function: every /api/* request goes to the shared router.
import { handle } from '../../shared/api.js';

export const onRequest = (ctx) => handle(ctx.request, ctx.env);
