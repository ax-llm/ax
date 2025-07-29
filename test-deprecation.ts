// Test to see if ax() is showing as deprecated
import { ax } from './src/ax/dsp/template.js';

// This should not show as deprecated
const gen = ax('userInput:string -> responseText:string');

console.log('ax function imported and used successfully');