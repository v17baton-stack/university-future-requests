import {setupTelegramHandler} from '../_shared/core.js';
Deno.serve(setupTelegramHandler(Deno.env.toObject()));
