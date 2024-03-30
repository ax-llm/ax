import { emScore } from '../dsp/eval.js';
import { BootstrapFewShot, MetricFn } from '../dsp/optimize.js';
import { AI, ChainOfThought, type OpenAIArgs } from '../index.js';

// Examples to start with. Handwritten or carefully created with a large model and human involvement.
const examples: { question: string; answer: string }[] = [
  {
    question: 'At My Window was released by which American singer-songwriter?',
    answer: 'John Townes Van Zandt'
  },
  {
    question:
      '"Everything Has Changed" is a song from an album released under which record label?',
    answer: 'Big Machine Records'
  },
  {
    question:
      'The Victorians - Their Story In Pictures is a documentary series written by an author born in what year?',
    answer: '1950'
  },
  {
    question:
      'Which Pakistani cricket umpire who won 3 consecutive ICC umpire of the year awards in 2009, 2010, and 2011 will be in the ICC World Twenty20?',
    answer: 'Aleem Sarwar Dar'
  },
  {
    question:
      'Having the combination of excellent foot speed and bat speed helped Eric Davis, create what kind of outfield for the Los Angeles Dodgers?',
    answer: '"Outfield of Dreams"'
  },
  {
    question:
      'Who is older, Aleksandr Danilovich Aleksandrov or Anatoly Fomenko?',
    answer: 'Aleksandr Danilovich Aleksandrov'
  },
  {
    question:
      'The Organisation that allows a community to influence their operation or use and to enjoy the benefits arising was founded in what year?',
    answer: '2010'
  },
  {
    question: 'Tombstone starred an actor born May 17, 1955 known as who?',
    answer: 'Bill Paxton'
  },
  {
    question:
      'In what year was the club founded that played Manchester City in the 1972 FA Charity Shield?',
    answer: '1874'
  },
  {
    question: 'Which American actor was Candace Kita guest-starred with?',
    answer: 'Bill Murray'
  },
  {
    question:
      'Which is taller, the Empire State Building or the Bank of America Tower?',
    answer: 'The Empire State Building'
  },
  {
    question:
      'Which company distributed this 1977 American animated film produced by Walt Disney Productions for which Sherman Brothers wrote songs?',
    answer: 'Buena Vista Distribution'
  }
];

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

// Setup the program to tune
const program = new ChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new BootstrapFewShot<{ question: string }, { answer: string }>(
  {
    program,
    examples
  }
);

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: MetricFn = ({ prediction, example }) =>
  emScore(prediction.answer as string, example.answer as string);

// Run the optimizer and save the result
await optimize.compile(metricFn, { filename: 'demos.json' });

console.log('> done. test with qna-use-tuned.ts');
