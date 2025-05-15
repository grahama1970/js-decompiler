/**
 * Unit tests for the deconstruct_pipeline.js file
 * 
 * Run with: npm test
 */
const fs = require('fs').promises;
const path = require('path');
const { sanitizeFilename, createFilePath, formatCodeWithComments } = require('../src/utils/helpers');

describe('JSReverse Pipeline', () => {
  describe('Helper Functions', () => {
    test('sanitizeFilename should clean invalid characters', () => {
      expect(sanitizeFilename('test-file.js')).toBe('test_file_js');
      expect(sanitizeFilename('__test__')).toBe('test');
      expect(sanitizeFilename('')).toBe('unnamed');
      expect(sanitizeFilename('function()')).toBe('function_');
    });

    test('createFilePath should generate correct paths', () => {
      expect(createFilePath('/output', 'function', 'test-func'))
        .toBe('/output/functions/test_func.js');
      expect(createFilePath('output', 'class', 'MyClass'))
        .toBe('output/classs/MyClass.js');
    });

    test('formatCodeWithComments should add proper comments', () => {
      const chunk = {
        type: 'function',
        name: 'testFunc',
        startLine: 10,
        endLine: 20
      };
      const code = 'function testFunc() {\n  return true;\n}';
      const expected = '// function: testFunc\n// Lines 10-20 from original.js\n\nfunction testFunc() {\n  return true;\n}';
      
      expect(formatCodeWithComments(code, chunk, 'original.js')).toBe(expected);
    });
  });

  describe('Pipeline Integration Test', () => {
    const testInputFile = path.join(__dirname, '../input/cli.js');
    const testOutputDir = path.join(__dirname, '../output/test_output');
    
    // Skip integration tests if running in CI environment
    test.skip('should process a minified JavaScript file', async () => {
      // This test would run the full pipeline
      // Since it requires credentials and is resource-intensive,
      // it's marked as skip by default
      
      // Implementation would:
      // 1. Check if input file exists
      // 2. Run pipeline with test input
      // 3. Verify output files were created
      // 4. Verify content of output files
    });
  });
});