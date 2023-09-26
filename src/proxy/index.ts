#!/usr/bin/env node

import 'dotenv/config';
import { LLMProxy } from './proxy';

const debug = (process.env.DEBUG ?? 'true') === 'true';

const port = parseInt(process.env.PORT ?? '') || 8081;

const proxy = new LLMProxy(port, debug);
proxy.start();
