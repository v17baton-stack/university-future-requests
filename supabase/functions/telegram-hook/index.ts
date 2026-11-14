import {telegramHookHandler} from '../_shared/core.js';
Deno.serve(telegramHookHandler(Deno.env.toObject()));
