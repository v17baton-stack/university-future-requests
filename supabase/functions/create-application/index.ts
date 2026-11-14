import {createApplicationHandler} from '../_shared/core.js';
Deno.serve(createApplicationHandler(Deno.env.toObject()));
