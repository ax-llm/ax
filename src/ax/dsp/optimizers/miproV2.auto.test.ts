import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AxGen } from '../generate';
import { AxMiPRO } from './miproV2';
import { AxAIService } from '../../ai';
import { AxAIHuggingFace } from '../../ai/huggingface/api';

// Mock AI Service
const mockAIService = {
  chat: vi.fn().mockResolvedValue({
    results: [{ content: 'mocked response' }],
  }),
} as unknown as AxAIService;

const mockOptimizerEndpoint = 'http://localhost:8000';

// Mock Python Optimizer Client
const mockPythonClient = {
  healthCheck: vi.fn().mockResolvedValue(true),
  createOptimizationJob: vi.fn().mockResolvedValue({ job_id: 'test_job' }),
  suggestParameters: vi.fn().mockResolvedValue({
    trial_number: 1,
    params: {
      temperature: 0.7,
      bootstrappedDemos: 1,
      instruction: 'test instruction',
      example_idx_0: 0,
    },
  }),
  evaluateTrial: vi.fn().mockResolvedValue(undefined),
  getStudyResults: vi.fn().mockResolvedValue({
    best_value: 0.9,
    best_params: {
      temperature: 0.7,
      bootstrappedDemos: 1,
      instruction: 'test instruction',
      example_idx_0: 0,
    },
  }),
  deleteStudy: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./pythonOptimizerClient', () => ({
  PythonOptimizerClient: vi.fn().mockImplementation(() => mockPythonClient),
}));

describe('AxMiPRO Auto Mode', () => {
  let optimizer: AxMiPRO;
  let program: AxGen<any, any>;
  const examples = [
    { question: 'a', answer: 'b' },
    { question: 'c', answer: 'd' },
  ];
  const metricFn = vi.fn().mockResolvedValue(0.9);

  beforeEach(() => {
    optimizer = new AxMiPRO({
      studentAI: new AxAIHuggingFace({
        apiKey: 'hf_...',
        model: 'google/flan-t-large',
      }),
      optimizerEndpoint: mockOptimizerEndpoint,
      maxLabeledDemos: 1,
    });
    program = new AxGen('question:string -> answer:string');
    vi.clearAllMocks();
  });

  it('should run compilePython with auto mode', async () => {
    const result = await optimizer.compile(program, examples, metricFn, {
      auto: 'light',
    });

    expect(mockPythonClient.createOptimizationJob).toHaveBeenCalled();
    expect(mockPythonClient.suggestParameters).toHaveBeenCalled();
    expect(mockPythonClient.evaluateTrial).toHaveBeenCalled();
    expect(mockPythonClient.getStudyResults).toHaveBeenCalled();
    expect(result.bestScore).toBe(0.9);
  });

  it('should run compilePython with zero-shot optimization', async () => {
    optimizer = new AxMiPRO({
      studentAI: new AxAIHuggingFace({
        apiKey: 'hf_...',
        model: 'google/flan-t-large',
      }),
      optimizerEndpoint: mockOptimizerEndpoint,
      maxBootstrappedDemos: 0,
      maxLabeledDemos: 0,
    });

    const result = await optimizer.compile(program, examples, metricFn, {
      auto: 'light',
    });

    expect(mockPythonClient.createOptimizationJob).toHaveBeenCalled();
    expect(mockPythonClient.suggestParameters).toHaveBeenCalled();
    expect(mockPythonClient.evaluateTrial).toHaveBeenCalled();
    expect(mockPythonClient.getStudyResults).toHaveBeenCalled();
    expect(result.bestScore).toBe(0.9);
  });

  it('should run compilePython with a teacher model', async () => {
    const teacher = new AxGen('question:string -> answer:string');

    const result = await optimizer.compile(program, examples, metricFn, {
      teacher,
    });

    expect(mockPythonClient.createOptimizationJob).toHaveBeenCalled();
    expect(mockPythonClient.suggestParameters).toHaveBeenCalled();
    expect(mockPythonClient.evaluateTrial).toHaveBeenCalled();
    expect(mockPythonClient.getStudyResults).toHaveBeenCalled();
    expect(result.bestScore).toBe(0.9);
  });
});
