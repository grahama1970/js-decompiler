/**
 * Rolling Window Summarizer
 * 
 * Provides efficient text summarization using LLM with configurable chunk sizes
 * and overlap. Handles long text via sequential chunking and progressive aggregation.
 * 
 * This is a simplified JavaScript version based on Python's MapReduce pattern.
 */

const fs = require('fs').promises;
const path = require('path');

// Configuration defaults
const DEFAULT_CONFIG = {
    chunkSize: 3500,            // Maximum tokens per chunk
    overlapSize: 100,           // Number of characters for overlap
    recursionLimit: 3,          // Maximum recursion depth for reduction
    contextLimitThreshold: 3800 // Maximum tokens to send to LLM
};

/**
 * Estimates token count from text
 * 
 * Simple estimation based on whitespace tokenization with adjustment factor
 * 
 * @param {string} text - Text to estimate
 * @returns {number} - Estimated token count
 */
function estimateTokenCount(text) {
    // A simple token estimation: ~4 chars per token is common for English
    const charsPerToken = 4;
    return Math.ceil(text.length / charsPerToken);
}

/**
 * Creates text chunks with overlap
 * 
 * @param {string} text - Text to chunk
 * @param {number} chunkSize - Maximum tokens per chunk 
 * @param {number} overlapSize - Number of characters for overlap
 * @returns {string[]} - Array of text chunks
 */
function createChunksWithOverlap(text, chunkSize, overlapSize) {
    // Convert tokens to approximate characters for chunking
    const charsPerToken = 4; // Approximation
    const chunkSizeChars = chunkSize * charsPerToken;
    const overlapSizeChars = overlapSize * charsPerToken;
    
    // Split into sentences (simplified)
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    const chunks = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
        // If this sentence would make the chunk too large, finalize current chunk
        if (estimateTokenCount(currentChunk + sentence) > chunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            
            // Start a new chunk, potentially with some overlap
            if (overlapSizeChars > 0 && currentChunk.length > overlapSizeChars) {
                // Extract the end of previous chunk for overlap
                currentChunk = currentChunk.slice(-overlapSizeChars);
            } else {
                currentChunk = '';
            }
        }
        
        // Add sentence to current chunk
        currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
    
    // Add the last chunk if it's not empty
    if (currentChunk) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}

/**
 * Summarize a single chunk of text
 * 
 * @param {string} chunkText - Text chunk to summarize
 * @param {Object} llmClient - LLM client (Vertex or Ollama)
 * @param {Object} config - Configuration options
 * @param {string} prompt - System prompt for summarization
 * @returns {Promise<string>} - Summarized text
 */
async function summarizeChunk(chunkText, llmClient, config, prompt) {
    console.log(`Summarizing chunk (${estimateTokenCount(chunkText)} tokens)...`);
    
    try {
        let response;
        
        if (config.provider === 'vertex') {
            // Call Vertex AI
            response = await llmClient.invoke([
                { role: 'system', content: prompt },
                { role: 'user', content: chunkText }
            ]);
            
            // Extract content from response
            return response.content;
        } else if (config.provider === 'ollama') {
            // Call Ollama
            response = await llmClient.client.chat({
                model: llmClient.model,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: chunkText }
                ],
                options: {
                    max_tokens: config.maxTokens || 1000,
                    temperature: 0.1
                }
            });
            
            return response.message.content;
        } else {
            throw new Error(`Unsupported provider: ${config.provider}`);
        }
    } catch (error) {
        console.error(`Error summarizing chunk: ${error.message}`);
        return `Error summarizing: ${error.message}`;
    }
}

/**
 * Recursively reduce text if it exceeds context limits
 * 
 * @param {string} textToReduce - Text to reduce
 * @param {Object} llmClient - LLM client
 * @param {Object} config - Configuration options
 * @param {string} finalPrompt - Prompt for final reduction
 * @param {number} currentDepth - Current recursion depth
 * @returns {Promise<string>} - Reduced text
 */
async function recursiveReduce(textToReduce, llmClient, config, finalPrompt, currentDepth = 0) {
    const inputTokens = estimateTokenCount(textToReduce);
    
    // Base case: Text fits within context limit
    if (inputTokens <= config.contextLimitThreshold) {
        console.log(`Recursion depth ${currentDepth}: Text fits (${inputTokens} tokens). Performing final summarization.`);
        return await summarizeChunk(textToReduce, llmClient, config, finalPrompt);
    }
    
    // Too deep in recursion, truncate
    if (currentDepth >= config.recursionLimit) {
        console.warn(`Max recursion depth (${config.recursionLimit}) reached. Truncating text.`);
        const truncatedText = textToReduce.slice(0, config.contextLimitThreshold * 4); // Approximate 4 chars per token
        return await summarizeChunk(truncatedText, llmClient, config, finalPrompt);
    }
    
    // Recursive case: Text too long, chunk it
    console.log(`Recursion depth ${currentDepth}: Text too long (${inputTokens} tokens). Re-chunking...`);
    const chunks = createChunksWithOverlap(textToReduce, config.chunkSize, config.overlapSize);
    
    // Summarize each chunk with intermediate prompt
    const intermediatePrompt = "Summarize the key points of this text segment:";
    const chunkSummaries = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const summary = await summarizeChunk(chunks[i], llmClient, config, intermediatePrompt);
        if (!summary.startsWith('Error summarizing:')) {
            chunkSummaries.push(summary);
        }
    }
    
    if (chunkSummaries.length === 0) {
        throw new Error('All chunk summarizations failed.');
    }
    
    // Combine summaries and recurse
    const combinedText = chunkSummaries.join('\n\n');
    return recursiveReduce(combinedText, llmClient, config, finalPrompt, currentDepth + 1);
}

/**
 * Main summarization function
 * 
 * @param {string} text - Text to summarize
 * @param {Object} llmClient - LLM client (Vertex or Ollama)
 * @param {Object} config - Configuration options
 * @returns {Promise<string>} - Summarized text
 */
async function summarizeText(text, llmClient, config = {}) {
    // Merge with defaults
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    
    if (!text || text.trim() === '') {
        throw new Error('Input text cannot be empty');
    }
    
    const inputTokens = estimateTokenCount(text);
    console.log(`Input text estimated tokens: ${inputTokens}`);
    
    // Direct summarization for short text
    if (inputTokens <= fullConfig.contextLimitThreshold) {
        console.log('Input text is within context limit. Summarizing directly.');
        const systemPrompt = "Summarize the following text concisely, preserving key information:";
        return await summarizeChunk(text, llmClient, fullConfig, systemPrompt);
    }
    
    // MapReduce for long text
    console.log('Input text exceeds context limit. Using chunking...');
    
    // 1. Create chunks
    const chunks = createChunksWithOverlap(text, fullConfig.chunkSize, fullConfig.overlapSize);
    console.log(`Created ${chunks.length} chunks.`);
    
    // 2. Summarize each chunk (Map)
    const chunkPrompt = "Summarize the key points of this text segment:";
    const chunkSummaries = [];
    
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i+1}/${chunks.length}...`);
        const summary = await summarizeChunk(chunks[i], llmClient, fullConfig, chunkPrompt);
        if (!summary.startsWith('Error summarizing:')) {
            chunkSummaries.push(summary);
        }
    }
    
    if (chunkSummaries.length === 0) {
        throw new Error('All chunk summarizations failed.');
    }
    
    // 3. Combine chunk summaries
    const combinedSummaryText = chunkSummaries.join('\n\n');
    const combinedTokens = estimateTokenCount(combinedSummaryText);
    console.log(`Combined ${chunkSummaries.length} chunk summaries. Combined tokens: ${combinedTokens}`);
    
    // 4. Reduce combined summaries
    const finalPrompt = "Synthesize the following summaries into a single, coherent summary:";
    const finalSummary = await recursiveReduce(
        combinedSummaryText, 
        llmClient, 
        fullConfig, 
        finalPrompt
    );
    
    const outputTokens = estimateTokenCount(finalSummary);
    console.log(`Chunked Summarization stats: Input=${inputTokens} tokens, Output=${outputTokens} tokens`);
    
    return finalSummary;
}

// Analyze a directory of JavaScript files
async function summarizeDirectory(dirPath, llmClient, config = {}) {
    // Create a recursive function to read all files in a directory
    async function readFilesRecursively(dir) {
        const allFiles = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                const subDirFiles = await readFilesRecursively(fullPath);
                allFiles.push(...subDirFiles);
            } else if (entry.name.endsWith('.js')) {
                allFiles.push(fullPath);
            }
        }
        
        return allFiles;
    }
    
    // Get all JavaScript files
    const files = await readFilesRecursively(dirPath);
    console.log(`Found ${files.length} JavaScript files in ${dirPath}`);
    
    // Group files by directory
    const filesByDir = {};
    for (const file of files) {
        const dir = path.dirname(file);
        if (!filesByDir[dir]) {
            filesByDir[dir] = [];
        }
        filesByDir[dir].push(file);
    }
    
    // Analyze each directory
    const dirSummaries = {};
    for (const [dir, dirFiles] of Object.entries(filesByDir)) {
        // Read and concatenate files
        let combinedContent = '';
        for (const file of dirFiles) {
            try {
                const content = await fs.readFile(file, 'utf8');
                combinedContent += `// File: ${path.basename(file)}\n${content}\n\n`;
            } catch (error) {
                console.error(`Error reading ${file}: ${error.message}`);
            }
        }
        
        // Skip empty directories
        if (!combinedContent.trim()) {
            continue;
        }
        
        // Summarize combined content
        try {
            const dirPrompt = `Analyze this directory of JavaScript files. Explain the purpose of the files and how they work together:`;
            const summary = await summarizeText(combinedContent, llmClient, {
                ...config,
                systemPrompt: dirPrompt
            });
            dirSummaries[dir] = summary;
        } catch (error) {
            console.error(`Error summarizing ${dir}: ${error.message}`);
            dirSummaries[dir] = `Error: ${error.message}`;
        }
    }
    
    return dirSummaries;
}

// Export functions
module.exports = {
    summarizeText,
    summarizeChunk,
    summarizeDirectory,
    estimateTokenCount,
    createChunksWithOverlap
};