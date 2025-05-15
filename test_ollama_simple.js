const ollama = require('ollama');

const testOllama = async () => {
  try {
    console.log('Testing Ollama API with a short prompt...');
    const ollamaClient = new ollama.Ollama({
      host: 'http://localhost:11435'
    });
    
    console.log('Starting timer...');
    const startTime = Date.now();
    
    const response = await ollamaClient.chat({
      model: 'qwen3:30b-a3b-q8_0',
      messages: [
        { 
          role: 'user', 
          content: 'Analyze this code: function add(a, b) { return a + b; }. Keep it very brief.' 
        }
      ],
      options: {
        temperature: 0.1,
        max_tokens: 100
      }
    });
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`Response received in ${duration} seconds!`);
    console.log('Response content:', response.message.content);
    
  } catch (error) {
    console.error('Error connecting to Ollama:', error);
  }
};

testOllama().then(() => {
  console.log('Test complete');
}).catch(err => {
  console.error('Test failed:', err);
});