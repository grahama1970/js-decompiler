const ollama = require('ollama');
const fs = require('fs').promises;

const testOllamaBatchAnalysis = async () => {
  try {
    console.log('Testing Ollama batch analysis approach...');
    const ollamaClient = new ollama.Ollama({
      host: 'http://localhost:11435'
    });
    
    // Create a simplified version of our consolidated analysis
    // with just one batch for testing
    const directoryContent = `
function example1() {
  return "Hello World";
}

function example2(a, b) {
  return a + b;
}

function example3(x) {
  if (x > 10) {
    return "Greater than 10";
  } else {
    return "Less than or equal to 10";
  }
}
    `;
    
    console.log('Starting batch analysis...');
    const startTime = Date.now();
    
    const prompt = `
Analyze the following function blocks:

\`\`\`javascript
${directoryContent}
\`\`\`

Please provide a brief consolidated analysis of these functions:
1. What is their overall purpose?
2. Are there any patterns you observe?
3. What would you name this module based on the analysis?

Keep your analysis very brief and concise (2-3 sentences total).
    `;
    
    console.log('Sending request to Ollama...');
    const response = await ollamaClient.chat({
      model: 'qwen3:30b-a3b-q8_0',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1,
        max_tokens: 150
      }
    });
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`Response received in ${duration} seconds!`);
    console.log('Response:', response.message.content);
    
    // Save the response to a test file
    await fs.writeFile(
      '/home/graham/workspace/experiments/js-decompiler/test_ollama_analysis.md', 
      `# Test Ollama Analysis\n\n${response.message.content}\n\nResponse time: ${duration} seconds`
    );
    console.log('Analysis saved to test_ollama_analysis.md');
    
  } catch (error) {
    console.error('Error with Ollama batch analysis:', error);
  }
};

testOllamaBatchAnalysis().then(() => {
  console.log('Batch test complete');
}).catch(err => {
  console.error('Batch test failed:', err);
});