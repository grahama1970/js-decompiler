/**
 * Rolling Window Summarizer
 * 
 * Provides efficient text summarization using LLM with configurable chunk sizes
 * and overlap. Handles long text via sequential chunking and progressive aggregation.
 * 
 * This is a simplified JavaScript version based on Python's MapReduce pattern.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { chunkContent, chunkByTokens } from './chunker.js';

// Configuration defaults
const DEFAULT_CONFIG = {
    chunkSize: 3500,            // Maximum tokens per chunk
    overlapSize: 100,           // Number of tokens for overlap
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
 * @param {number} overlapSize - Number of tokens for overlap
 * @returns {string[]} - Array of text chunks
 */
function createChunksWithOverlap(text, chunkSize, overlapSize) {
    // Use the chunker utility to create token-based chunks
    const chunks = chunkByTokens(text, chunkSize, true, overlapSize);
    return chunks.map(chunk => chunk.content);
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
        
        // Handle different LLM providers
        if (llmClient.provider === 'vertex') {
            // Call Vertex AI
            response = await llmClient.model.invoke([
                { role: 'user', content: prompt + '\n\n' + chunkText }
            ]);
            
            // Extract content from response based on structure
            if (response.content) {
                return response.content;
            } else if (response.lc_kwargs?.content) {
                return response.lc_kwargs.content;
            } else if (typeof response === 'string') {
                return response;
            }
            return 'Unexpected response format';
            
        } else if (llmClient.provider === 'ollama') {
            // Call Ollama
            response = await llmClient.client.chat({
                model: llmClient.model,
                messages: [{ role: 'user', content: prompt + '\n\n' + chunkText }],
                options: { 
                    max_tokens: llmClient.maxTokens,
                    temperature: 0.1
                }
            });
            
            // Extract content from Ollama response
            if (response.message?.content) {
                return response.message.content;
            } else if (response.text || response.content) {
                return response.text || response.content;
            } else if (typeof response === 'string') {
                return response;
            }
            return 'Unexpected response format';
        }
        
        throw new Error(`Unsupported LLM provider: ${llmClient.provider}`);
    } catch (error) {
        console.error(`Error summarizing chunk: ${error.message}`);
        return `ERROR: ${error.message}`;
    }
}

/**
 * Performs recursive MapReduce-like summarization for long texts
 * 
 * @param {string} text - Text to summarize
 * @param {Object} llmClient - LLM client (Vertex or Ollama)
 * @param {Object} config - Configuration options
 * @param {string} prompt - System prompt for summarization
 * @param {number} recursionLevel - Current recursion level
 * @returns {Promise<string>} - Summarized text
 */
async function recursiveSummarize(text, llmClient, config, prompt, recursionLevel = 0) {
    // Use defaults if config not provided
    const actualConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Check if text is small enough to send to LLM directly
    if (estimateTokenCount(text) <= actualConfig.contextLimitThreshold) {
        return await summarizeChunk(text, llmClient, actualConfig, prompt);
    }
    
    // Check recursion limit
    if (recursionLevel >= actualConfig.recursionLimit) {
        console.warn(`Reached recursion limit (${actualConfig.recursionLimit}), truncating text`);
        // Truncate text to fit context limit
        const truncatedText = text.slice(0, actualConfig.contextLimitThreshold * 4);
        return await summarizeChunk(truncatedText, llmClient, actualConfig, prompt);
    }
    
    // Create chunks with overlap
    const chunks = createChunksWithOverlap(text, actualConfig.chunkSize, actualConfig.overlapSize);
    console.log(`Split text into ${chunks.length} chunks for level ${recursionLevel}`);
    
    // MAP: Summarize each chunk
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i+1}/${chunks.length} at level ${recursionLevel}`);
        const summary = await summarizeChunk(chunks[i], llmClient, actualConfig, prompt);
        summaries.push(summary);
    }
    
    // REDUCE: Combine summaries recursively
    const combinedSummaries = summaries.join('\n\n');
    
    // If combined summaries are still too large, recurse
    if (estimateTokenCount(combinedSummaries) > actualConfig.contextLimitThreshold) {
        console.log(`Combined summaries still too large (${estimateTokenCount(combinedSummaries)} tokens), recursing to level ${recursionLevel + 1}`);
        return await recursiveSummarize(
            combinedSummaries,
            llmClient,
            actualConfig,
            `Please create a high-level summary of these summaries:\n\n${prompt}`,
            recursionLevel + 1
        );
    }
    
    // Final summary of combined summaries
    return await summarizeChunk(combinedSummaries, llmClient, actualConfig, 
        `Please create a final coherent summary of these section summaries:\n\n${prompt}`);
}

/**
 * Main function to summarize text
 * 
 * @param {string} text - Text to summarize
 * @param {Object} llmClient - LLM client (Vertex or Ollama)
 * @param {Object} config - Configuration options
 * @param {string} prompt - System prompt
 * @returns {Promise<string>} - Summarized text
 */
export async function summarizeText(text, llmClient, config = {}, prompt = 'Please summarize this text:') {
    return recursiveSummarize(text, llmClient, config, prompt);
}

/**
 * Summarize all files in a directory
 * 
 * @param {string} directory - Directory containing files to summarize
 * @param {Object} llmClient - LLM client (Vertex or Ollama)
 * @param {Object} config - Configuration options
 * @param {string} customPrompt - Optional custom prompt
 * @returns {Promise<string>} - Combined summary
 */
export async function summarizeDirectory(directory, llmClient, config = {}, customPrompt = null) {
    try {
        // Get all files in directory
        const files = await fs.readdir(directory);
        const jsFiles = files.filter(file => file.endsWith('.js'));
        
        if (jsFiles.length === 0) {
            return 'No JavaScript files found in directory';
        }
        
        console.log(`Found ${jsFiles.length} JavaScript files in ${directory}`);
        
        // Create prompt based on directory type
        const dirType = path.basename(directory);
        const prompt = customPrompt || `Please analyze these ${dirType} and explain their purpose, patterns, and relationships:`;
        
        // Read and combine all files
        let combinedContent = '';
        for (const file of jsFiles) {
            const filePath = path.join(directory, file);
            try {
                const content = await fs.readFile(filePath, 'utf8');
                // Add file separator with name for context
                combinedContent += `\n\n--- File: ${file} ---\n\n${content}`;
            } catch (err) {
                console.error(`Error reading ${filePath}: ${err.message}`);
            }
        }
        
        // Check if size exceeds chunking threshold
        const estimatedTokens = estimateTokenCount(combinedContent);
        console.log(`Input text estimated tokens: ${estimatedTokens}`);
        
        if (estimatedTokens > DEFAULT_CONFIG.contextLimitThreshold) {
            console.log(`Input text exceeds context limit. Using chunking...`);
            // Use recursive chunking for large combined content
            return await recursiveSummarize(combinedContent, llmClient, config, prompt);
        } else {
            // Small enough for direct summarization
            return await summarizeChunk(combinedContent, llmClient, config, prompt);
        }
        
    } catch (error) {
        console.error(`Error summarizing directory: ${error.message}`);
        return `ERROR: ${error.message}`;
    }
}