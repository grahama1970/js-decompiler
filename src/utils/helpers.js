/**
 * Utility functions for the JavaScript deconstruction pipeline
 */

/**
 * Sanitizes a filename by replacing invalid characters with underscores
 * @param {string} name - The string to sanitize
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}

/**
 * Creates a readable file path for output files
 * @param {string} outputDir - The output directory
 * @param {string} type - The file type (function, class, etc.)
 * @param {string} name - The file name
 * @returns {string} The full file path
 */
export function createFilePath(outputDir, type, name) {
  const sanitizedName = sanitizeFilename(name);
  return `${outputDir}/${type}s/${sanitizedName}.js`;
}

/**
 * Formats a code chunk with appropriate comments
 * @param {string} code - The code content
 * @param {object} chunk - The chunk metadata
 * @param {string} originalFile - The name of the original file
 * @returns {string} Formatted code with comments
 */
export function formatCodeWithComments(code, chunk, originalFile) {
  return `// ${chunk.type}: ${chunk.name}\n// Lines ${chunk.startLine}-${chunk.endLine} from ${originalFile}\n\n${code}`;
}

// Run validation when this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const results = [];
  
  // Use dynamic import for assert (needed for top-level validation)
  const { default: assert } = await import('assert');
  
  // Test sanitizeFilename
  try {
    assert.strictEqual(sanitizeFilename('test-file.js'), 'test_file_js');
    assert.strictEqual(sanitizeFilename('____test____'), 'test');
    assert.strictEqual(sanitizeFilename(''), 'unnamed');
    results.push('✅ sanitizeFilename tests passed');
  } catch (error) {
    results.push(`❌ sanitizeFilename test failed: ${error.message}`);
  }
  
  // Test createFilePath
  try {
    assert.strictEqual(
      createFilePath('/output', 'function', 'test-func'),
      '/output/functions/test_func.js'
    );
    results.push('✅ createFilePath tests passed');
  } catch (error) {
    results.push(`❌ createFilePath test failed: ${error.message}`);
  }
  
  // Test formatCodeWithComments
  try {
    const chunk = {
      type: 'function',
      name: 'testFunc',
      startLine: 10,
      endLine: 20
    };
    const code = 'function testFunc() {\n  return true;\n}';
    const expected = '// function: testFunc\n// Lines 10-20 from original.js\n\nfunction testFunc() {\n  return true;\n}';
    assert.strictEqual(formatCodeWithComments(code, chunk, 'original.js'), expected);
    results.push('✅ formatCodeWithComments tests passed');
  } catch (error) {
    results.push(`❌ formatCodeWithComments test failed: ${error.message}`);
  }
  
  // Print results
  console.log('\nValidation results:');
  results.forEach(result => console.log(result));
  console.log(`\n${results.every(r => r.includes('✅')) ? '✅ All tests passed' : '❌ Some tests failed'}`);
}