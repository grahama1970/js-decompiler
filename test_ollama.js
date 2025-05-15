const ollama = require('ollama');

const testOllama = async () => {
  try {
    console.log('Initializing Ollama client...');
    const ollamaClient = new ollama.Ollama({
      host: 'http://localhost:11435'
    });
    
    console.log('Sending request to Ollama...');
    const response = await ollamaClient.chat({
      model: 'qwen3:30b-a3b-q8_0',
      messages: [{ role: 'user', content: 'What is 2+2? Answer in one word.' }],
      options: {
        max_tokens: 10
      }
    });
    
    console.log('Response from Ollama:');
    console.log(response);
  } catch (error) {
    console.error('Error testing Ollama:', error);
  }
};

testOllama();