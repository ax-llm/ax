#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { Crawler } from '../data/crawler.js';
import { HTMLCrawler } from '../data/html.js';
import { LLMProxy } from '../proxy/proxy.js';

yargs(hideBin(process.argv))
  .command(
    'proxy',
    'Launch the LLM proxy',
    (yargs) => {
      return yargs.options({
        port: {
          alias: 'p',
          type: 'number',
          description: 'port to bind on',
          default: 8081,
        },
        debug: {
          alias: 'd',
          type: 'boolean',
          description: 'enable debug logging',
          default: false,
        },
      });
    },
    (argv) => {
      const proxy = new LLMProxy(argv.port, argv.debug);
      proxy.start();
    }
  )
  .command(
    'spider',
    'Launch the vectorizing spider',
    (yargs) => {
      return yargs.options({
        url: {
          alias: 'u',
          type: 'string',
          description: 'url to spider',
          required: true,
        },
        depth: {
          alias: 'd',
          type: 'number',
          description: 'depth to spider',
          default: 2,
        },
        debug: {
          alias: 'd',
          type: 'boolean',
          description: 'enable debug logging',
          default: false,
        },
        domains: {
          alias: 'd',
          type: 'array',
          description: 'domains to spider allow list',
          default: [],
        },
        chunkSize: {
          alias: 'c',
          type: 'number',
          description: 'chunk size for LLM',
          default: 512,
        },
        llmAPIKey: {
          alias: 'k',
          type: 'string',
          description: 'LLM API Key',
          required: true,
        },
        llmType: {
          alias: 't',
          type: 'string',
          description: 'LLM Type',
          default: 'openai',
        },
        dbHost: {
          alias: 'h',
          type: 'string',
          description: 'DB Host',
          required: true,
        },
        dbAPIKey: {
          alias: 'k',
          type: 'string',
          description: 'DB API Key',
          required: true,
        },
        dbTable: {
          alias: 't',
          type: 'string',
          description: 'DB Table',
          required: true,
        },
        dbNamespace: {
          alias: 'n',
          type: 'string',
          description: 'DB Namespace',
        },
      });
    },
    async (argv) => {
      const crawler = new Crawler({
        llmAPIKey: argv.llmAPIKey,
        llmType: argv.llmType,
        llmOptions: {},
        dbAPIKey: argv.dbAPIKey,
        dbHost: argv.dbHost,
        dbTable: argv.dbTable,
        dbNamespace: argv.dbNamespace,
        dbOptions: {},
        startPage: argv.url,
        handleRequest: HTMLCrawler(argv.chunkSize),
        config: {
          depth: argv.depth,
          domains: argv.domains as string[],
        },
      });
      await crawler.crawl();
    }
  )
  .demandCommand()
  .parse();
