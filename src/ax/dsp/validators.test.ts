import { describe, expect, it } from 'vitest';
import type { AxField } from './sig.js';
import {
  validateNumberConstraints,
  validateStringConstraints,
  validateURL,
} from './validators.js';

describe('validateURL', () => {
  const createField = (name: string): AxField => ({
    name,
    title: name,
    description: 'Test field',
    type: { name: 'url', isArray: false },
    isOptional: false,
  });

  it('should accept valid URLs', () => {
    const field = createField('website');

    expect(() => validateURL('https://example.com', field)).not.toThrow();
    expect(() => validateURL('http://example.com', field)).not.toThrow();
    expect(() =>
      validateURL('https://sub.example.com/path', field)
    ).not.toThrow();
    expect(() => validateURL('https://example.com:8080', field)).not.toThrow();
    expect(() => validateURL('ftp://files.example.com', field)).not.toThrow();
  });

  it('should reject invalid URLs', () => {
    const field = createField('website');

    expect(() => validateURL('not a url', field)).toThrow(/Invalid URL format/);
    expect(() => validateURL('example.com', field)).toThrow(
      /Invalid URL format/
    );
    expect(() => validateURL('', field)).toThrow(/Invalid URL format/);
    // Note: 'htp://broken.com' is actually valid per URL spec, just uncommon protocol
  });

  it('should reject non-string values', () => {
    const field = createField('website');

    expect(() => validateURL(123, field)).toThrow(/URL must be a string/);
    expect(() => validateURL(null, field)).toThrow(/URL must be a string/);
    expect(() => validateURL(undefined, field)).toThrow(/URL must be a string/);
    expect(() => validateURL({}, field)).toThrow(/URL must be a string/);
  });

  it('should include field name in error messages', () => {
    const field = createField('profileURL');

    try {
      validateURL('invalid', field);
      throw new Error('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('profileURL');
    }
  });
});

describe('validateStringConstraints', () => {
  const createField = (
    name: string,
    constraints: {
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: string;
    }
  ): AxField => ({
    name,
    title: name,
    description: 'Test field',
    type: { name: 'string', isArray: false, ...constraints },
    isOptional: false,
  });

  describe('minLength constraint', () => {
    it('should accept strings meeting minimum length', () => {
      const field = createField('username', { minLength: 3 });

      expect(() => validateStringConstraints('abc', field)).not.toThrow();
      expect(() => validateStringConstraints('abcd', field)).not.toThrow();
      expect(() =>
        validateStringConstraints('a very long string', field)
      ).not.toThrow();
    });

    it('should reject strings below minimum length', () => {
      const field = createField('username', { minLength: 3 });

      expect(() => validateStringConstraints('ab', field)).toThrow(
        /at least 3 characters/
      );
      expect(() => validateStringConstraints('a', field)).toThrow(
        /at least 3 characters/
      );
      expect(() => validateStringConstraints('', field)).toThrow(
        /at least 3 characters/
      );
    });
  });

  describe('maxLength constraint', () => {
    it('should accept strings within maximum length', () => {
      const field = createField('bio', { maxLength: 10 });

      expect(() => validateStringConstraints('short', field)).not.toThrow();
      expect(() =>
        validateStringConstraints('exactly10!', field)
      ).not.toThrow();
      expect(() => validateStringConstraints('', field)).not.toThrow();
    });

    it('should reject strings exceeding maximum length', () => {
      const field = createField('bio', { maxLength: 10 });

      expect(() =>
        validateStringConstraints('this is too long', field)
      ).toThrow(/at most 10 characters/);
      expect(() => validateStringConstraints('12345678901', field)).toThrow(
        /at most 10 characters/
      );
    });
  });

  describe('minLength and maxLength combined', () => {
    it('should accept strings in valid range', () => {
      const field = createField('password', { minLength: 8, maxLength: 20 });

      expect(() => validateStringConstraints('password', field)).not.toThrow();
      expect(() => validateStringConstraints('12345678', field)).not.toThrow();
      expect(() =>
        validateStringConstraints('12345678901234567890', field)
      ).not.toThrow();
    });

    it('should reject strings outside range', () => {
      const field = createField('password', { minLength: 8, maxLength: 20 });

      expect(() => validateStringConstraints('short', field)).toThrow(
        /at least 8 characters/
      );
      expect(() =>
        validateStringConstraints(
          'this password is way too long to be valid',
          field
        )
      ).toThrow(/at most 20 characters/);
    });
  });

  describe('pattern constraint', () => {
    it('should accept strings matching pattern', () => {
      const field = createField('code', { pattern: '^[A-Z0-9]+$' });

      expect(() => validateStringConstraints('ABC123', field)).not.toThrow();
      expect(() => validateStringConstraints('HELLO', field)).not.toThrow();
      expect(() => validateStringConstraints('999', field)).not.toThrow();
    });

    it('should reject strings not matching pattern', () => {
      const field = createField('code', { pattern: '^[A-Z0-9]+$' });

      expect(() => validateStringConstraints('abc123', field)).toThrow(
        /must match pattern/
      );
      expect(() => validateStringConstraints('ABC-123', field)).toThrow(
        /must match pattern/
      );
      expect(() => validateStringConstraints('hello world', field)).toThrow(
        /must match pattern/
      );
    });

    it('should handle complex patterns', () => {
      // Password with at least one letter and one digit
      const field = createField('password', {
        pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
      });

      expect(() =>
        validateStringConstraints('password123', field)
      ).not.toThrow();
      expect(() => validateStringConstraints('abc1', field)).not.toThrow();

      expect(() => validateStringConstraints('password', field)).toThrow(
        /must match pattern/
      );
      expect(() => validateStringConstraints('12345', field)).toThrow(
        /must match pattern/
      );
    });
  });

  describe('email format', () => {
    it('should accept valid email addresses', () => {
      const field = createField('email', { format: 'email' });

      expect(() =>
        validateStringConstraints('user@example.com', field)
      ).not.toThrow();
      expect(() =>
        validateStringConstraints('test.user@domain.co.uk', field)
      ).not.toThrow();
      expect(() =>
        validateStringConstraints('name+tag@example.org', field)
      ).not.toThrow();
    });

    it('should reject invalid email addresses', () => {
      const field = createField('email', { format: 'email' });

      // cspell:disable-next-line
      expect(() => validateStringConstraints('notanemail', field)).toThrow(
        /valid email address/
      );
      expect(() => validateStringConstraints('@example.com', field)).toThrow(
        /valid email address/
      );
      expect(() => validateStringConstraints('user@', field)).toThrow(
        /valid email address/
      );
      expect(() =>
        validateStringConstraints('user @example.com', field)
      ).toThrow(/valid email address/);
      expect(() => validateStringConstraints('user@domain', field)).toThrow(
        /valid email address/
      );
    });
  });

  describe('url format', () => {
    it('should accept valid URLs', () => {
      const field = createField('website', { format: 'uri' });

      expect(() =>
        validateStringConstraints('https://example.com', field)
      ).not.toThrow();
      expect(() =>
        validateStringConstraints('http://sub.domain.com/path', field)
      ).not.toThrow();
    });

    it('should reject invalid URLs', () => {
      const field = createField('website', { format: 'uri' });

      expect(() => validateStringConstraints('not a url', field)).toThrow(
        /valid URL/
      );
      expect(() => validateStringConstraints('example.com', field)).toThrow(
        /valid URL/
      );
    });
  });

  describe('combined constraints', () => {
    it('should validate all constraints together', () => {
      const field = createField('username', {
        minLength: 3,
        maxLength: 20,
        pattern: '^[a-z0-9]+$',
      });

      expect(() => validateStringConstraints('john123', field)).not.toThrow();

      // Too short
      expect(() => validateStringConstraints('ab', field)).toThrow(
        /at least 3 characters/
      );

      // Too long
      expect(() =>
        // cspell:disable-next-line
        validateStringConstraints('thisusernameiswaytoolong', field)
      ).toThrow(/at most 20 characters/);

      // Invalid pattern (uppercase)
      expect(() => validateStringConstraints('John123', field)).toThrow(
        /must match pattern/
      );
    });
  });

  describe('non-string values', () => {
    it('should skip validation for non-string values', () => {
      const field = createField('text', { minLength: 5 });

      // These should not throw because the function returns early for non-strings
      expect(() => validateStringConstraints(123, field)).not.toThrow();
      expect(() => validateStringConstraints(null, field)).not.toThrow();
      expect(() => validateStringConstraints(undefined, field)).not.toThrow();
    });
  });

  describe('field without type', () => {
    it('should skip validation if field has no type', () => {
      const field: AxField = {
        name: 'test',
        description: 'Test',
        isOptional: false,
      };

      expect(() =>
        validateStringConstraints('any string', field)
      ).not.toThrow();
    });
  });
});

describe('validateNumberConstraints', () => {
  const createField = (
    name: string,
    constraints: {
      minimum?: number;
      maximum?: number;
    }
  ): AxField => ({
    name,
    title: name,
    description: 'Test field',
    type: { name: 'number', isArray: false, ...constraints },
    isOptional: false,
  });

  describe('minimum constraint', () => {
    it('should accept numbers meeting minimum', () => {
      const field = createField('age', { minimum: 18 });

      expect(() => validateNumberConstraints(18, field)).not.toThrow();
      expect(() => validateNumberConstraints(25, field)).not.toThrow();
      expect(() => validateNumberConstraints(100, field)).not.toThrow();
    });

    it('should reject numbers below minimum', () => {
      const field = createField('age', { minimum: 18 });

      expect(() => validateNumberConstraints(17, field)).toThrow(/at least 18/);
      expect(() => validateNumberConstraints(0, field)).toThrow(/at least 18/);
      expect(() => validateNumberConstraints(-5, field)).toThrow(/at least 18/);
    });

    it('should handle zero as minimum', () => {
      const field = createField('count', { minimum: 0 });

      expect(() => validateNumberConstraints(0, field)).not.toThrow();
      expect(() => validateNumberConstraints(5, field)).not.toThrow();
      expect(() => validateNumberConstraints(-1, field)).toThrow(/at least 0/);
    });
  });

  describe('maximum constraint', () => {
    it('should accept numbers within maximum', () => {
      const field = createField('rating', { maximum: 5 });

      expect(() => validateNumberConstraints(0, field)).not.toThrow();
      expect(() => validateNumberConstraints(3, field)).not.toThrow();
      expect(() => validateNumberConstraints(5, field)).not.toThrow();
    });

    it('should reject numbers exceeding maximum', () => {
      const field = createField('rating', { maximum: 5 });

      expect(() => validateNumberConstraints(6, field)).toThrow(/at most 5/);
      expect(() => validateNumberConstraints(100, field)).toThrow(/at most 5/);
    });
  });

  describe('minimum and maximum combined', () => {
    it('should accept numbers in valid range', () => {
      const field = createField('percentage', { minimum: 0, maximum: 100 });

      expect(() => validateNumberConstraints(0, field)).not.toThrow();
      expect(() => validateNumberConstraints(50, field)).not.toThrow();
      expect(() => validateNumberConstraints(100, field)).not.toThrow();
    });

    it('should reject numbers outside range', () => {
      const field = createField('percentage', { minimum: 0, maximum: 100 });

      expect(() => validateNumberConstraints(-1, field)).toThrow(/at least 0/);
      expect(() => validateNumberConstraints(101, field)).toThrow(
        /at most 100/
      );
    });
  });

  describe('decimal numbers', () => {
    it('should handle decimal numbers correctly', () => {
      const field = createField('price', { minimum: 0.01, maximum: 999.99 });

      expect(() => validateNumberConstraints(0.01, field)).not.toThrow();
      expect(() => validateNumberConstraints(50.5, field)).not.toThrow();
      expect(() => validateNumberConstraints(999.99, field)).not.toThrow();

      expect(() => validateNumberConstraints(0.005, field)).toThrow(
        /at least 0.01/
      );
      expect(() => validateNumberConstraints(1000, field)).toThrow(
        /at most 999.99/
      );
    });
  });

  describe('negative numbers', () => {
    it('should handle negative number ranges', () => {
      const field = createField('temperature', { minimum: -50, maximum: 50 });

      expect(() => validateNumberConstraints(-50, field)).not.toThrow();
      expect(() => validateNumberConstraints(0, field)).not.toThrow();
      expect(() => validateNumberConstraints(50, field)).not.toThrow();

      expect(() => validateNumberConstraints(-51, field)).toThrow(
        /at least -50/
      );
      expect(() => validateNumberConstraints(51, field)).toThrow(/at most 50/);
    });
  });

  describe('non-number values', () => {
    it('should skip validation for non-number values', () => {
      const field = createField('count', { minimum: 0, maximum: 100 });

      // These should not throw because the function returns early for non-numbers
      expect(() => validateNumberConstraints('123', field)).not.toThrow();
      expect(() => validateNumberConstraints(null, field)).not.toThrow();
      expect(() => validateNumberConstraints(undefined, field)).not.toThrow();
    });
  });

  describe('field without type', () => {
    it('should skip validation if field has no type', () => {
      const field: AxField = {
        name: 'test',
        description: 'Test',
        isOptional: false,
      };

      expect(() => validateNumberConstraints(42, field)).not.toThrow();
    });
  });

  describe('error messages', () => {
    it('should include field name in error messages', () => {
      const field = createField('userAge', { minimum: 18 });

      try {
        validateNumberConstraints(16, field);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('userAge');
        expect((error as Error).message).toContain('at least 18');
      }
    });

    it('should provide clear validation messages', () => {
      const field = createField('score', { minimum: 0, maximum: 100 });

      try {
        validateNumberConstraints(-5, field);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Number must be at least 0');
      }

      try {
        validateNumberConstraints(150, field);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain(
          'Number must be at most 100'
        );
      }
    });
  });
});
