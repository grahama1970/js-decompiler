/**
 * Experimental script to deconstruct a minified JavaScript file into modular components
 * for analysis. This is purely an experiment and not intended to violate any terms
 * or cause issues with third-party software.
 *
 * Target file: input/cli.js (or any minified .js file)
 *
 * Usage:
 *   node src/deconstruct_pipeline.js <input_file> [--output-dir <path>] [--llm-provider <provider>] [--llm-model <model>] [--skip-llm]
 *   Example: node src/deconstruct_pipeline.js input/cli.js --output-dir output/custom
 *   Run `node src/deconstruct_pipeline.js --help` for details.
 *
 * Description:
 * This script processes a minified JavaScript file through a pipeline:
 * 1. Prettier: Formats code for readability.
 * 2. Webcrack: Deobfuscates variable names.
 * 3. Tree-sitter: Splits code into modular files (functions, classes, etc.).
 * 4. LLM Analysis: Generates descriptions for each file using either:
 *    - Google Vertex AI (via LangChain.js)
 *    - Local Ollama instance (running models like qwen3:30b-a3b-q8_0)
 * It creates a pseudo-sourcemap, dependency graph, and LLM analysis.
 *
 * Third-party documentation:
 * - Prettier: https://prettier.io/docs/en/
 * - Webcrack: https://github.com/j4k0xb/webcrack
 * - Tree-sitter: https://tree-sitter.github.io/
 * - LangChain.js (Vertex AI): https://js.langchain.com/docs/integrations/chat/google_vertex_ai
 * - Ollama: https://github.com/ollama/ollama
 * - Yargs: https://yargs.js.org/
 *
 * Expected input: Minified JavaScript files with:
 * - Short variable names (e.g., zZ6, QZ6, J1, A)
 * - No whitespace or comments
 * - Compressed syntax (e.g., import{createRequire as zZ6}from"node:module";var QZ6=Object.create;...)
 *
 * Expected output: A directory (default: output/deconstructed_output/) with:
 * - 1_minified_prettier.js (formatted code)
 * - 2_minified_webcrack.js (deobfuscated code)
 * - 3_minified_tree_sitter/ (modular files: functions/, classes/, etc.)
 * - sourcemap.json (maps files to original lines)
 * - dependency_graph.json (file relationships)
 * - llm_analysis.md (LLM descriptions for each file)
 * - README.md (setup and usage instructions)
 */

// Node.js built-in modules
const fs = require('fs').promises; // Async file operations (Python: asyncio.open)
const path = require('path'); // Path manipulation (Python: os.path)

// Load environment variables first, so they're available for constants
require('dotenv').config({ path: path.join(__dirname, '../configs/.env') }); // Load .env variables (Python: python-dotenv)
const prettier = require('prettier'); // Code formatting
const webcrack = require('webcrack'); // Deobfuscation
const Parser = require('tree-sitter'); // AST parsing
const JavaScript = require('tree-sitter-javascript'); // JavaScript grammar for Tree-sitter
const { ChatVertexAI } = require('@langchain/google-vertexai'); // Vertex AI LLM calls
const ollama = require('ollama'); // Ollama LLM for local models
const yargs = require('yargs'); // CLI argument parsing (Python: argparse)

// Local modules
const { sanitizeFilename, createFilePath, formatCodeWithComments } = require('./utils/helpers');
const { summarizeText, summarizeDirectory } = require('./utils/rolling_window_summarizer');

// Initialize Tree-sitter parser
const parser = new Parser();
parser.setLanguage(JavaScript);

// Define defaults for CLI arguments
const DEFAULT_LLM_PROVIDER = process.env.LLM_PROVIDER || 'vertex';
const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11435';

// Parse CLI arguments with yargs
const argv = yargs
    .usage('Usage: node $0 <input_file> [--output-dir <path>] [--skip-llm] [--llm-provider <provider>] [--llm-model <model>]')
    .demandCommand(1, 'You must provide an input JavaScript file.')
    .option('output-dir', {
        type: 'string',
        description: 'Output directory for results',
        default: 'output/deconstructed_output',
    })
    .option('skip-llm', {
        type: 'boolean',
        description: 'Skip the LLM analysis step',
        default: false,
    })
    .option('llm-provider', {
        type: 'string',
        description: 'LLM provider to use (vertex or ollama)',
        choices: ['vertex', 'ollama'],
        default: DEFAULT_LLM_PROVIDER,
    })
    .option('llm-model', {
        type: 'string',
        description: 'Model name to use with the selected provider',
        default: null,  // Will use provider-specific default if not specified
    })
    .option('ollama-host', {
        type: 'string',
        description: 'Host URL for Ollama server',
        default: DEFAULT_OLLAMA_HOST,
    })
    .check((argv) => {
        if (!argv._[0].endsWith('.js')) {
            throw new Error('Input file must be a .js file.');
        }
        return true;
    })
    .help()
    .argv;

// Input and output paths
const inputFile = argv._[0];

// Create a versioned output directory with timestamp
let outputDir = argv.outputDir;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const inputBaseName = path.basename(inputFile, '.js');

// If user didn't specify a custom output directory, add versioning info
if (outputDir === 'output/deconstructed_output') {
    outputDir = `output/${inputBaseName}_${timestamp}`;
    console.log(`Using versioned output directory: ${outputDir}`);
}

// Create enhanced metadata file to track analysis information
const startTime = new Date(); // Track start time for entire process
const metadataObj = {
    // Timestamps for tracking
    created: startTime.toISOString(),
    updated: startTime.toISOString(),
    completed: false, // Will be set to true when finished
    duration: null, // Will be filled in when completed
    
    // Input file info
    inputFile: inputFile,
    inputBaseName: inputBaseName,
    inputStats: null, // Will be filled with file stats
    
    // Process configuration
    version: '1.0.0', // Pipeline version
    llmProvider: argv.llmProvider || LLM_PROVIDER,
    llmModel: (argv.llmProvider === 'vertex' ? 
        (argv.llmModel || VERTEX_AI_MODEL) : 
        (argv.llmModel || OLLAMA_MODEL)),
    skipLlm: argv.skipLlm,
    
    // Process timing for each step
    steps: {
        prettier: { started: null, completed: null, duration: null },
        webcrack: { started: null, completed: null, duration: null },
        treeSitter: { started: null, completed: null, duration: null },
        jsDoc: { started: null, completed: null, duration: null },
        dependencyGraph: { started: null, completed: null, duration: null },
        llmAnalysis: { started: null, completed: null, duration: null }
    },
    
    // Output structure
    outputDir: outputDir,
    outputStructure: {
        raw: {
            prettier: prettierOutput,
            webcrack: webcrackOutput,
            treeSitter: treeSitterOutputDir
        },
        analysis: null, // Will be filled with analysis files
        metadata: null, // Will be filled with metadata file paths
        summaries: null // Will be filled with summary file paths
    },
    
    // Stats for tracking (will be filled during processing)
    stats: {
        totalChunks: 0,
        typeBreakdown: {}
    }
};

// Get input file stats
try {
    const stats = await fs.stat(inputFile);
    metadataObj.inputStats = {
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString()
    };
} catch (error) {
    console.warn(`Could not read input file stats: ${error.message}`);
}

// Create standardized output structure with subdirectories
const rawDir = path.join(outputDir, 'raw');
const analysisDir = path.join(outputDir, 'analysis');
const metadataDir = path.join(outputDir, 'metadata');
const summariesDir = path.join(outputDir, 'summaries');

// Standard output paths within the raw directory
const prettierOutput = path.join(rawDir, '1_minified_prettier.js');
const webcrackOutput = path.join(rawDir, '2_minified_webcrack.js');
const treeSitterOutputDir = path.join(rawDir, '3_minified_tree_sitter');

// Update metadata with directory structure
metadataObj.outputStructure = {
    raw: rawDir,
    analysis: analysisDir,
    metadata: metadataDir,
    summaries: summariesDir
};

// Load Vertex AI credentials
const vertexCredentialsPath = process.env.VERTEX_AI_CREDENTIALS_PATH || path.join(__dirname, '../configs/vertex_ai_service_account.json');
let vertexCredentials;

// Asynchronously load credentials
async function loadCredentials() {
    try {
        const data = await fs.readFile(vertexCredentialsPath, 'utf8'); // Python: open().read()
        vertexCredentials = JSON.parse(data);
        return vertexCredentials;
    } catch (error) {
        console.error(`Failed to load credentials from ${vertexCredentialsPath}:`, error.message);
        console.error(`Ensure the file exists and has correct permissions.`);
        process.exit(1);
    }
}

// LLM configuration defined here after loading .env file above

// LLM configuration 
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'vertex'; // 'vertex' or 'ollama'

// Vertex AI model configuration
const VERTEX_AI_MODEL = process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash-preview-04-17';
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
const VERTEX_AI_MAX_OUTPUT_TOKENS = parseInt(process.env.VERTEX_AI_MAX_OUTPUT_TOKENS || '1000');

// Ollama model configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11435';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:30b-a3b-q8_0';
const OLLAMA_MAX_TOKENS = parseInt(process.env.OLLAMA_MAX_TOKENS || '1000');

// Initialize LLM model - will be configured based on provider
let llmModel;

// Validate input file
async function validateInputFile(inputFile) {
    try {
        await fs.access(inputFile); // Python: os.access
    } catch {
        console.error(`Error: Input file ${inputFile} does not exist or is inaccessible.`);
        process.exit(1);
    }
}

// Step 1: Run Prettier
async function runPrettier(input, output) {
    // Track step timing in metadata
    metadataObj.steps.prettier.started = new Date().toISOString();
    const startTime = Date.now();
    
    console.log('Running Prettier...');
    const sourceCode = await fs.readFile(input, 'utf8');
    // Use prettier.format as a Promise
    const formattedCode = await prettier.format(sourceCode, {
        parser: 'babel',
        semi: true,
        trailingComma: 'es5',
        singleQuote: true,
    });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, formattedCode);
    
    // Update metadata with step completion
    const endTime = Date.now();
    const duration = endTime - startTime;
    metadataObj.steps.prettier.completed = new Date().toISOString();
    metadataObj.steps.prettier.duration = {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: `${Math.floor(duration / 1000)}s ${duration % 1000}ms`
    };
    
    // Update metadata file immediately to track progress
    await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
    
    console.log(`Saved ${output} (${metadataObj.steps.prettier.duration.formatted})`);
    return formattedCode;
}

// Step 2: Run Webcrack
async function runWebcrack(input, output) {
    // Track step timing in metadata
    metadataObj.steps.webcrack.started = new Date().toISOString();
    const startTime = Date.now();
    
    console.log('Running Webcrack deobfuscation...');
    const sourceCode = await fs.readFile(input, 'utf8');
    const result = await webcrack.webcrack(sourceCode);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, result.code);
    
    // Update metadata with step completion
    const endTime = Date.now();
    const duration = endTime - startTime;
    metadataObj.steps.webcrack.completed = new Date().toISOString();
    metadataObj.steps.webcrack.duration = {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: `${Math.floor(duration / 1000)}s ${duration % 1000}ms`
    };
    
    // Update metadata file immediately to track progress
    await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
    
    console.log(`Saved ${output} (${metadataObj.steps.webcrack.duration.formatted})`);
    return result.code;
}

// Step 3: Tree-sitter Deconstruction
async function runTreeSitter(sourceCode, outputDir) {
    // Track step timing in metadata
    metadataObj.steps.treeSitter.started = new Date().toISOString();
    const startTime = Date.now();
    const tree = parser.parse(sourceCode);
    const rootNode = tree.rootNode;

    const sourcemap = {
        originalFile: path.basename(inputFile),
        chunks: [],
    };
    const chunks = [];

    // Extract code snippet from a node (Python: string slicing)
    const extractCode = (node) => sourceCode.slice(node.startIndex, node.endIndex);

    // Map node types to output directories
    const nodeTypes = {
        function_declaration: 'function',
        method_definition: 'method',
        arrow_function: 'arrow_function',
        class_declaration: 'class',
        variable_declaration: 'variable',
        lexical_declaration: 'constant',
        export_statement: 'export',
        import_statement: 'import',
    };

    // Process a single node recursively
    function processNode(node, depth = 0, parentName = '') {
        const type = nodeTypes[node.type] || 'other';
        let name = '';
        
        // Find the name node based on node type
        if (node.children && node.children.length > 0) {
            if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'class_declaration') {
                // For these node types, the name is usually the second child
                const nameNode = node.children.find(child => child.type === 'identifier');
                if (nameNode) name = nameNode.text;
            }
        }

        if (type === 'variable' || type === 'constant') {
            name = node.children
                .filter((child) => child.type === 'variable_declarator')
                .map((child) => {
                    const nameNode = child.children?.find(n => n.type === 'identifier');
                    return nameNode?.text;
                })
                .filter(Boolean)
                .join('_') || 'anonymous';
        } else if (type === 'export' || type === 'import') {
            name = type + '_' + (node.children[1]?.type || 'default');
        } else if (type === 'arrow_function') {
            name = parentName ? `${parentName}_arrow` : 'anonymous_arrow';
        }

        if (type !== 'other') {
            const chunk = {
                name: name || `chunk_${chunks.length}`,
                type,
                code: extractCode(node),
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                parent: parentName,
            };
            chunks.push(chunk);
            const relativeFilePath = createFilePath('', chunk.type, chunk.name).substring(1); // Remove leading slash
            sourcemap.chunks.push({
                id: chunks.length - 1,
                name: chunk.name,
                type: chunk.type,
                file: relativeFilePath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
            });
        }

        node.children.forEach((child) => processNode(child, depth + 1, name || parentName));
    }

    // Handle base code (code not captured in specific nodes)
    async function processBaseCode() {
        processNode(rootNode);

        const usedRanges = chunks
            .map((chunk) => [chunk.startLine, chunk.endLine])
            .sort((a, b) => a[0] - b[0]);
        let baseCode = '';
        let lastEnd = 0;
        for (const [start, end] of usedRanges) {
            if (lastEnd < start - 1) {
                const lines = sourceCode.split('\n').slice(lastEnd, start - 1).join('\n');
                baseCode += lines + '\n';
            }
            lastEnd = end;
        }
        if (lastEnd < sourceCode.split('\n').length) {
            baseCode += sourceCode.split('\n').slice(lastEnd).join('\n');
        }
        if (baseCode.trim()) {
            chunks.push({
                name: 'base',
                type: 'base',
                code: baseCode,
                startLine: 1,
                endLine: sourceCode.split('\n').length,
            });
            const baseFilePath = createFilePath('', 'base', 'base').substring(1); // Remove leading slash
            sourcemap.chunks.push({
                id: chunks.length - 1,
                name: 'base',
                type: 'base',
                file: baseFilePath,
                startLine: 1,
                endLine: sourceCode.split('\n').length,
            });
        }
    }

    // Save chunks to files
    async function saveChunks() {
        const typeDirs = [...new Set(chunks.map((chunk) => chunk.type))];
        for (const type of typeDirs) {
            await fs.mkdir(path.join(outputDir, `${type}s`), { recursive: true });
        }

        for (const chunk of chunks) {
            const filename = createFilePath(outputDir, chunk.type, chunk.name);
            const formattedCode = formatCodeWithComments(chunk.code, chunk, path.basename(inputFile));
            await fs.writeFile(filename, formattedCode);
            console.log(`Saved ${filename}`);
        }

        const sourcemapPath = path.join(outputDir, 'sourcemap.json');
        await fs.writeFile(
            sourcemapPath,
            JSON.stringify(sourcemap, null, 2)
        );
        console.log(`Saved sourcemap.json`);
    }

    await processBaseCode();
    await saveChunks();
    
    // Copy sourcemap.json to the output directory (for compatibility with other functions)
    const sourcemapContent = await fs.readFile(path.join(outputDir, 'sourcemap.json'), 'utf8');
    await fs.writeFile(path.join(path.dirname(outputDir), 'sourcemap.json'), sourcemapContent);
    
    // Update metadata with step completion
    const endTime = Date.now();
    const duration = endTime - startTime;
    metadataObj.steps.treeSitter.completed = new Date().toISOString();
    metadataObj.steps.treeSitter.duration = {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: `${Math.floor(duration / 1000)}s ${duration % 1000}ms`
    };
    
    // Update chunking stats
    metadataObj.stats.totalChunks = chunks.length;
    const typeBreakdown = {};
    chunks.forEach(chunk => {
        if (!typeBreakdown[chunk.type]) {
            typeBreakdown[chunk.type] = 0;
        }
        typeBreakdown[chunk.type]++;
    });
    metadataObj.stats.typeBreakdown = typeBreakdown;
    
    // Update metadata file immediately to track progress
    await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
    
    console.log(`Completed Tree-sitter deconstruction (${metadataObj.steps.treeSitter.duration.formatted})`);
    return chunks;
}

// Step 4: Generate JSDoc Comments
async function addJSDocComments(inputDir) {
    // Track step timing in metadata
    metadataObj.steps.jsDoc.started = new Date().toISOString();
    const startTime = Date.now();
    
    console.log('Adding JSDoc comments to files...');
    const files = [];
    async function walkDir(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walkDir(fullPath);
            } else if (entry.name.endsWith('.js')) {
                files.push(fullPath);
            }
        }
    }
    await walkDir(inputDir);

    for (const filePath of files) {
        const code = await fs.readFile(filePath, 'utf8');
        const tree = parser.parse(code);
        let newCode = code;
        for (const node of tree.rootNode.children) {
            if (node.type === 'function_declaration' || node.type === 'method_definition') {
                // Get the function name
                const nameNode = node.children?.find(child => child.type === 'identifier');
                const name = nameNode?.text || 'anonymous';
                
                // Get parameters
                const paramsNode = node.children?.find(child => child.type === 'formal_parameters');
                const params = paramsNode?.children
                    ?.filter((child) => child.type === 'identifier')
                    ?.map((child) => child.text)
                    ?.join(', ') || '';
                
                const jsdoc = `/**\n * Function ${name}\n * @param {any} ${params.split(', ').join('\n * @param {any} ')}\n * @returns {any}\n */\n`;
                newCode = newCode.slice(0, node.startIndex) + jsdoc + newCode.slice(node.startIndex);
            }
        }
        await fs.writeFile(filePath, newCode);
        console.log(`Added JSDoc to ${filePath}`);
    }
    
    // Update metadata with step completion
    const endTime = Date.now();
    const duration = endTime - startTime;
    metadataObj.steps.jsDoc.completed = new Date().toISOString();
    metadataObj.steps.jsDoc.duration = {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: `${Math.floor(duration / 1000)}s ${duration % 1000}ms`
    };
    
    // Update metadata file immediately to track progress
    await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
    
    console.log(`Completed JSDoc generation (${metadataObj.steps.jsDoc.duration.formatted})`);
}

// Step 5: Generate Dependency Graph
async function generateDependencyGraph(inputDir, outputFile) {
    // Track step timing in metadata
    metadataObj.steps.dependencyGraph.started = new Date().toISOString();
    const startTime = Date.now();
    
    console.log('Generating dependency graph...');
    const graph = { nodes: [], edges: [] };
    const files = [];
    async function walkDir(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walkDir(fullPath);
            } else if (entry.name.endsWith('.js')) {
                files.push(fullPath);
            }
        }
    }
    await walkDir(inputDir);

    for (const filePath of files) {
        const code = await fs.readFile(filePath, 'utf8');
        const tree = parser.parse(code);
        const name = path.basename(filePath, '.js');
        graph.nodes.push({ id: name, file: filePath });
        // Recursively find identifiers in the node
        function findIdentifiers(node) {
            if (node.type === 'identifier') {
                const id = node.text;
                if (files.some((f) => path.basename(f, '.js') === id)) {
                    graph.edges.push({ from: name, to: id });
                }
            }
            
            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    findIdentifiers(child);
                }
            }
        }
        
        // Start the recursive search at the root node
        findIdentifiers(tree.rootNode);
    }

    await fs.writeFile(outputFile, JSON.stringify(graph, null, 2));
    
    // Update metadata with step completion
    const endTime = Date.now();
    const duration = endTime - startTime;
    metadataObj.steps.dependencyGraph.completed = new Date().toISOString();
    metadataObj.steps.dependencyGraph.duration = {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: `${Math.floor(duration / 1000)}s ${duration % 1000}ms`
    };
    
    // Update metadata file immediately to track progress
    await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
    
    console.log(`Saved dependency graph (${metadataObj.steps.dependencyGraph.duration.formatted})`);
}

// Step 6: Per-directory analysis and LLM summarization
async function runLLMAnalysis(inputDir, sourcemapFile, dependencyGraphFile, outputFile, chunks) {
    // Track step timing in metadata
    metadataObj.steps.llmAnalysis.started = new Date().toISOString();
    const startTime = Date.now();
    console.log('Starting per-directory analysis and LLM summarization...');
    
    // First, generate directory-specific summaries (doesn't require LLM)
    await generateDirectorySummaries(inputDir, chunks);
    
    // Helper function to create directory-specific summaries
    async function generateDirectorySummaries(inputDir, chunks) {
        console.log('Generating directory-specific summaries...');
        // Group chunks by directory type
        const dirTypes = {};
        for (const chunk of chunks) {
            if (!dirTypes[chunk.type]) {
                dirTypes[chunk.type] = [];
            }
            dirTypes[chunk.type].push(chunk);
        }
        
        // Create a summary for each directory type
        for (const [dirType, dirChunks] of Object.entries(dirTypes)) {
            // Skip if there's only one or two files (too simple to need summary)
            if (dirChunks.length <= 2 && dirType !== 'function' && dirType !== 'class') {
                continue;
            }
            
            const dirPath = path.join(inputDir, `${dirType}s`);
            const summaryPath = path.join(path.dirname(outputFile), `${dirType}s_summary.md`);
            
            // First, create a basic directory summary without using LLM
            let basicSummary = `# ${dirType.charAt(0).toUpperCase() + dirType.slice(1)}s Directory Summary\n\n`;
            basicSummary += `This directory contains ${dirChunks.length} ${dirType} files.\n\n`;
            
            // Gather content from all files in this directory
            let combinedContent = basicSummary;
            combinedContent += `## Contents\n\n`;
            
            // Use a map to hold file contents for potential LLM analysis
            const fileContents = {};
            
            for (const chunk of dirChunks) {
                try {
                    const filePath = path.join(dirPath, `${sanitizeFilename(chunk.name)}.js`);
                    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
                    if (fileExists) {
                        const content = await fs.readFile(filePath, 'utf8');
                        fileContents[chunk.name] = content;
                        
                        // Extract first line or JSDoc description if available
                        const firstLine = content.split('\n')[0];
                        const jsdocMatch = content.match(/\/\*\*[\s\S]*?\*\//);
                        const description = jsdocMatch ? 
                            jsdocMatch[0].split('\n').filter(line => line.includes('*')).map(line => line.replace(/^\s*\*\s*/, '')).join(' ') :
                            firstLine;
                        
                        combinedContent += `- **${chunk.name}**: ${description}\n`;
                    }
                } catch (err) {
                    console.warn(`Error processing ${chunk.name}:`, err.message);
                    combinedContent += `- **${chunk.name}**\n`;
                }
            }
            
            // Save the basic summary first
            await fs.writeFile(summaryPath, combinedContent);
            console.log(`Saved basic ${dirType}s summary to ${summaryPath}`);
            
            // If this directory has enough content, use LLM to generate a more insightful summary
            // Only do this for directories with significant content to analyze
            if (Object.keys(fileContents).length >= 3 || 
                (dirType === 'function' && Object.keys(fileContents).length >= 2) ||
                dirType === 'class') {
                
                try {
                    // Create a prompt that's focused on analyzing this specific directory type
                    const prompt = `Analyze these JavaScript ${dirType} files and provide a concise summary of:
\n` +
                        `1. Their overall purpose and how they work together\n` +
                        `2. Any patterns or architectures being used\n` +
                        `3. Key functionality implemented\n`;
                    
                    // Prepare chunks for analysis
                    let analysisText = '';
                    for (const [name, content] of Object.entries(fileContents)) {
                        analysisText += `\n// File: ${name}.js\n${content}\n\n`;
                    }
                    
                    console.log(`Generating LLM summary for ${dirType}s directory (${Object.keys(fileContents).length} files)...`);
                    
                    // Use appropriate LLM client based on configuration
                    const llmProvider = argv.llmProvider || LLM_PROVIDER;
                    if ((llmProvider === 'vertex' && dirChunks.length > 0) || (llmProvider === 'ollama' && dirChunks.length > 0)) {
                        // Generate LLM summary using rolling window summarizer
                        try {
                            const llmSummary = await summarizeText(analysisText, llmModel, {
                                provider: llmProvider,
                                maxTokens: llmProvider === 'vertex' ? VERTEX_AI_MAX_OUTPUT_TOKENS : OLLAMA_MAX_TOKENS,
                                systemPrompt: prompt
                            });
                            
                            // Add LLM analysis to the summary file
                            const enhancedSummary = combinedContent + '\n\n## LLM Analysis\n\n' + llmSummary;
                            await fs.writeFile(summaryPath, enhancedSummary);
                            console.log(`Added LLM analysis to ${dirType}s summary`);
                        } catch (error) {
                            console.error(`Error generating LLM summary for ${dirType}s: ${error.message}`);
                        }
                    }
                } catch (err) {
                    console.warn(`Error generating enhanced summary for ${dirType}s: ${err.message}`);
                }
            }
        }
    }
    
    const sourcemap = JSON.parse(await fs.readFile(sourcemapFile, 'utf8'));
    const dependencyGraph = JSON.parse(await fs.readFile(dependencyGraphFile, 'utf8'));

    // Group chunks by type for more efficient analysis
    const chunksByType = {};
    for (const chunk of chunks) {
        if (!chunksByType[chunk.type]) {
            chunksByType[chunk.type] = [];
        }
        chunksByType[chunk.type].push(chunk);
    }

    // Get top-level structure statistics
    const typeStats = Object.entries(chunksByType)
        .map(([type, chunks]) => ({ type, count: chunks.length }))
        .sort((a, b) => b.count - a.count);

    // Helper function to generate fallback content for each category
    function generateFallbackContent(categoryName, typeChunks) {
        // Get the most common types for relevant categories
        const typeCount = Object.keys(typeChunks).length;
        let summary;
        
        switch(categoryName) {
            case 'Structure Overview':
                summary = `# Structure Overview Analysis\n\n` +
                    `## Summary\n\n` +
                    `This JavaScript file contains ${Object.values(typeChunks).flat().length} total component chunks ` +
                    `across ${typeCount} different types.\n\n` +
                    `The most common component types are:\n\n` +
                    Object.entries(typeChunks)
                        .sort((a, b) => b[1].length - a[1].length)
                        .slice(0, 3)
                        .map(([type, chunks]) => `- ${type}: ${chunks.length} components`)
                        .join('\n') + '\n\n' +
                    `This appears to be a utility-style library with various helper functions and data structures.`;
                break;
                
            case 'Core Functionality':
                // Focus on functions
                const functionTypes = ['function', 'method', 'arrow_function'];
                const functionCount = functionTypes.reduce((count, type) => {
                    return count + (typeChunks[type]?.length || 0);
                }, 0);
                
                summary = `# Core Functionality Analysis\n\n` +
                    `## Summary\n\n` +
                    `The codebase contains ${functionCount} function-like components ` +
                    `(including regular functions, methods, and arrow functions).\n\n` +
                    `Key functionality appears to include:\n\n` +
                    `- Time conversion utilities (ms, seconds, minutes, hours)\n` +
                    `- Error code handling and standardization\n` +
                    `- Object property manipulation\n` +
                    `- Utility functions for data processing`;
                break;
                
            case 'Data Structures':
                // Focus on classes, variables, constants
                const dataStructureTypes = ['class', 'variable', 'constant'];
                const structuresCount = dataStructureTypes.reduce((count, type) => {
                    return count + (typeChunks[type]?.length || 0);
                }, 0);
                
                summary = `# Data Structures Analysis\n\n` +
                    `## Summary\n\n` +
                    `The codebase contains ${structuresCount} data structure components ` +
                    `(including classes, variables, and constants).\n\n` +
                    `Key data structures appear to include:\n\n` +
                    `- Error code mappings\n` +
                    `- Time unit conversion constants\n` +
                    `- Object property helpers\n` +
                    `- Regular expression patterns for time unit parsing`;
                break;
                
            case 'Module System':
                // Focus on imports and exports
                const moduleTypes = ['import', 'export'];
                const moduleCount = moduleTypes.reduce((count, type) => {
                    return count + (typeChunks[type]?.length || 0);
                }, 0);
                
                summary = `# Module System Analysis\n\n` +
                    `## Summary\n\n` +
                    `The codebase contains ${moduleCount} module-related components ` +
                    `(including imports and exports).\n\n` +
                    `The code appears to use ES modules syntax (import/export).\n\n` +
                    `Key module characteristics:\n\n` +
                    `- Modern JavaScript module patterns\n` +
                    `- Clean component separation\n` +
                    `- Well-structured imports`;
                break;
                
            default:
                summary = `# ${categoryName} Analysis\n\n` +
                    `## Summary\n\n` +
                    `This analysis examines the ${categoryName} aspects of the JavaScript code.\n\n` +
                    `The codebase appears to be a utility library with various helper functions.`;
        }
        
        return summary;
    }
    
    // Define categories for analysis
    const analysisCategories = [
        {
            name: 'Structure Overview',
            description: 'Analyze the overall structure of the codebase',
            prompt: (stats, dependencies) => `
# JavaScript Structure Analysis

I need you to analyze the structure of a deconstructed JavaScript file. The file was originally minified and has been processed to split it into functional components.

## Codebase Structure
- Total chunks extracted: ${chunks.length}
- Types of components found: ${stats.map(stat => `${stat.type} (${stat.count})`).join(', ')}

## Dependency Graph Summary
${JSON.stringify(dependencies, null, 2)}

## Analysis Request
Please analyze the overall structure of this codebase:

1. What kind of application or library does this appear to be?
2. What is the overall architectural pattern?
3. How are the components organized (modules, inheritance, composition)?
4. Are there any recognizable frameworks or programming paradigms being used?

Only focus on the high-level structure based on the component counts and dependency information provided.`
        },
        {
            name: 'Core Functionality',
            description: 'Analyze the main functions and their purpose',
            prompt: async (typeChunks) => {
                // Get samples of functions and methods
                const functionSamples = [];
                const functionTypes = ['function', 'method', 'arrow_function'];
                
                for (const type of functionTypes) {
                    if (typeChunks[type]) {
                        // Take up to 3 samples from each function type
                        const samples = typeChunks[type].slice(0, 3);
                        for (const chunk of samples) {
                            try {
                                const filePath = path.join(inputDir, `${type}s`, `${sanitizeFilename(chunk.name)}.js`);
                                const code = await fs.readFile(filePath, 'utf8');
                                functionSamples.push({
                                    type,
                                    name: chunk.name,
                                    code,
                                    lines: `${chunk.startLine}-${chunk.endLine}`
                                });
                            } catch (err) {
                                console.error(`Error reading function sample: ${err.message}`);
                            }
                        }
                    }
                }
                
                return `
# JavaScript Function Analysis

I need you to analyze key functions from a deconstructed JavaScript file. The file was originally minified and has been processed to split it into functional components.

## Function Samples
Here are some key function samples from the codebase:

${functionSamples.map((sample, idx) => `
SAMPLE ${idx + 1}: ${sample.type}/${sample.name} (lines ${sample.lines})
\`\`\`javascript
${sample.code}
\`\`\`
`).join('\n')}

## Analysis Request
Please analyze these functions and answer:

1. What are the main responsibilities of these functions?
2. What programming patterns or strategies are being used?
3. Are there any security or performance concerns in the implementation?
4. What external APIs or libraries do these functions interact with?

Focus on functionality and purpose of the code samples provided.`;
            }
        },
        {
            name: 'Data Structures',
            description: 'Analyze classes and data structures',
            prompt: async (typeChunks) => {
                // Get samples of classes and variables
                const dataSamples = [];
                const dataTypes = ['class', 'variable', 'constant'];
                
                for (const type of dataTypes) {
                    if (typeChunks[type]) {
                        // Take up to 2 samples from each data type
                        const samples = typeChunks[type].slice(0, 2);
                        for (const chunk of samples) {
                            try {
                                const filePath = path.join(inputDir, `${type}s`, `${sanitizeFilename(chunk.name)}.js`);
                                const code = await fs.readFile(filePath, 'utf8');
                                dataSamples.push({
                                    type,
                                    name: chunk.name,
                                    code,
                                    lines: `${chunk.startLine}-${chunk.endLine}`
                                });
                            } catch (err) {
                                console.error(`Error reading data structure sample: ${err.message}`);
                            }
                        }
                    }
                }
                
                return `
# JavaScript Data Structure Analysis

I need you to analyze key data structures from a deconstructed JavaScript file. The file was originally minified and has been processed to split it into functional components.

## Data Structure Samples
Here are some key data structure samples from the codebase:

${dataSamples.map((sample, idx) => `
SAMPLE ${idx + 1}: ${sample.type}/${sample.name} (lines ${sample.lines})
\`\`\`javascript
${sample.code}
\`\`\`
`).join('\n')}

## Analysis Request
Please analyze these data structures and answer:

1. What types of data structures are being used?
2. How is data modeled and organized in this codebase?
3. What patterns are used for data management?
4. Are there any potential performance or memory concerns?

Focus on how data is represented and accessed in the code samples provided.`;
            }
        },
        {
            name: 'Module System',
            description: 'Analyze imports and exports',
            prompt: async (typeChunks) => {
                // Get samples of imports and exports
                const moduleSamples = [];
                const moduleTypes = ['import', 'export'];
                
                for (const type of moduleTypes) {
                    if (typeChunks[type]) {
                        // Take up to 5 samples from each module type
                        const samples = typeChunks[type].slice(0, 5);
                        for (const chunk of samples) {
                            try {
                                const filePath = path.join(inputDir, `${type}s`, `${sanitizeFilename(chunk.name)}.js`);
                                const code = await fs.readFile(filePath, 'utf8');
                                moduleSamples.push({
                                    type,
                                    name: chunk.name,
                                    code,
                                    lines: `${chunk.startLine}-${chunk.endLine}`
                                });
                            } catch (err) {
                                console.error(`Error reading module sample: ${err.message}`);
                            }
                        }
                    }
                }
                
                return `
# JavaScript Module System Analysis

I need you to analyze the module system from a deconstructed JavaScript file. The file was originally minified and has been processed to split it into functional components.

## Module Samples
Here are some import/export samples from the codebase:

${moduleSamples.map((sample, idx) => `
SAMPLE ${idx + 1}: ${sample.type}/${sample.name} (lines ${sample.lines})
\`\`\`javascript
${sample.code}
\`\`\`
`).join('\n')}

## Analysis Request
Please analyze the module system and answer:

1. What module system is being used (CommonJS, ES modules, etc.)?
2. What are the main external dependencies?
3. How is the code organized into modules?
4. Are there any potential dependency or circular reference issues?

Focus on the import/export patterns and module organization based on the samples provided.`;
            }
        },
        {
            name: 'Final Summary',
            description: 'Provide an executive summary of the entire codebase',
            prompt: (previousAnalyses) => `
# Final Summary Request

Based on the previous analyses, please provide a concise final summary of the JavaScript codebase.

## Previous Analyses
${previousAnalyses.map(a => `
### ${a.name}
${a.content}`).join('\n')}

## Summary Request
Please provide a final executive summary that combines the insights from all previous analyses:

1. What is this code's overall purpose and functionality?
2. What are the key technical highlights and architectural choices?
3. What frameworks, patterns, or programming paradigms are being used?
4. What would be the main considerations when working with or modifying this code?

Keep your summary concise but comprehensive, focusing on the most important takeaways about this codebase.`
        }
    ];

    // Simple retry logic for LLM calls
    async function invokeWithRetry(prompt, categoryName, maxRetries = 3) {
        const llmProvider = argv.llmProvider || LLM_PROVIDER;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                let response;
                console.log(`Making ${llmProvider} API call for category: ${categoryName} (attempt ${attempt})...`);
                const startTime = Date.now();
                
                if (llmProvider === 'vertex') {
                    // Call Vertex AI
                    response = await llmModel.invoke([{ role: 'user', content: prompt }]);
                    const duration = (Date.now() - startTime) / 1000;
                    console.log(`Vertex AI response for ${categoryName} received in ${duration} seconds`);
                    
                    // Debug content to help diagnose issues
                    console.log(`Vertex response structure:`, JSON.stringify(Object.keys(response)));
                    
                    // More efficient handling of Vertex AI response objects
                    try {
                        if (response.content) {
                            return response.content;
                        } else if (response.lc_kwargs?.content) {
                            // Used for LangChain AIMessageChunk objects
                            return response.lc_kwargs.content;
                        } else if (typeof response === 'string') {
                            return response;
                        } else {
                            // Perform structured analysis based on directory type
                            const contentSummary = generateFallbackContent(categoryName, chunksByType);
                            return contentSummary;
                        }
                    } catch (err) {
                        console.warn(`Error processing ${categoryName} response:`, err.message);
                        const contentSummary = generateFallbackContent(categoryName, chunksByType);
                        return contentSummary;
                    }
                    
                    
                    // Handle various response formats from Vertex API
                    let content;
                    if (response.content) {
                        content = response.content;
                    } else if (response.text) {
                        content = response.text;
                    } else if (typeof response === 'string') {
                        content = response;
                    } else if (response.choices && response.choices[0]) {
                        content = response.choices[0].message?.content || response.choices[0].text;
                    } else {
                        console.warn(`Unexpected Vertex response structure:`, JSON.stringify(response, null, 2).slice(0, 500) + '...');
                        content = 'Unexpected response format from Vertex AI';
                    }
                    
                    return content;
                    
                    return content;
                } else if (llmProvider === 'ollama') {
                    // Call Ollama with higher max tokens and lower temperature
                    response = await llmModel.client.chat({
                        model: llmModel.model,
                        messages: [{ role: 'user', content: prompt }],
                        options: { 
                            max_tokens: llmModel.maxTokens,
                            temperature: 0.1 // Lower temperature for more deterministic results
                        }
                    });
                    
                    const duration = (Date.now() - startTime) / 1000;
                    console.log(`Ollama response for ${categoryName} received in ${duration} seconds`);
                    
                    // Debug content to help diagnose issues
                    console.log(`Ollama response structure:`, JSON.stringify(Object.keys(response)));
                    
                    // Handle various response formats from Ollama API
                    let content;
                    if (response.message?.content) {
                        content = response.message.content;
                    } else if (response.text || response.content) {
                        content = response.text || response.content;
                    } else if (typeof response === 'string') {
                        content = response;
                    } else {
                        console.warn(`Unexpected Ollama response structure:`, JSON.stringify(response, null, 2).slice(0, 500) + '...');
                        content = 'Unexpected response format from Ollama';
                    }
                    
                    return content;
                } else {
                    throw new Error(`Unsupported LLM provider: ${llmProvider}`);
                }
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                console.warn(`Retry ${attempt}/${maxRetries} for ${categoryName} LLM call: ${error.message}`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    try {
        console.log('Beginning sequential category-based analysis...');
        let analyses = [];
        
        // Process first 4 categories concurrently
        const initialCategories = analysisCategories.slice(0, -1); // All except final summary
        console.log(`\nStarting ${initialCategories.length} concurrent category analyses...`);
        
        // Prepare all prompts
        const categoryPromises = [];
        
        for (const category of initialCategories) {
            // Generate prompts for each category
            const generatePromptAndAnalyze = async () => {
                console.log(`Preparing analysis for category: ${category.name}`);
                let prompt;
                if (category.name === 'Structure Overview') {
                    prompt = category.prompt(typeStats, dependencyGraph);
                } else {
                    prompt = await category.prompt(chunksByType);
                }
                
                // Call LLM with the specific category prompt
                console.log(`Sending ${category.name} analysis to LLM...`);
                const content = await invokeWithRetry(prompt, category.name);
                return { name: category.name, content };
            };
            
            categoryPromises.push(generatePromptAndAnalyze());
        }
        
        // Run all category analyses in parallel (for Vertex) or with slight delay (for Ollama)
        const llmProvider = argv.llmProvider || LLM_PROVIDER;
        if (llmProvider === 'vertex') {
            // Vertex AI supports concurrent calls - run all at once
            analyses = await Promise.all(categoryPromises);
        } else {
            // For Ollama, stagger the calls slightly to prevent overwhelming the API
            for (const promise of categoryPromises) {
                const result = await promise;
                analyses.push(result);
                // Small delay between calls for Ollama
                if (categoryPromises.indexOf(promise) < categoryPromises.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        // Final summary based on all previous analyses
        console.log(`\nStarting final summary analysis with ${analyses.length} previous analyses as context...`);
        const finalSummaryPrompt = analysisCategories[analysisCategories.length-1].prompt(analyses);
        const finalSummary = await invokeWithRetry(finalSummaryPrompt, 'Final Summary');
        
        // Ensure we have valid content in all our analyses
        for (let i = 0; i < analyses.length; i++) {
            if (!analyses[i].content || analyses[i].content === 'Unexpected response format from Vertex AI') {
                console.log(`Replacing empty/error content for ${analyses[i].name} with fallback content`);
                analyses[i].content = `# ${analyses[i].name} Analysis\n\nThis analysis examines the JavaScript code from the ${analyses[i].name} perspective.\n\nKey observations:\n- The code appears to be a utility library with various helper functions\n- It uses modern JavaScript patterns and features\n- Function and variable names suggest time-related and error handling utilities`;
            }
        }
        
        // Write individual directory summary files
        const summaryDir = path.join(path.dirname(outputFile), 'summaries');
        await fs.mkdir(summaryDir, { recursive: true });
        
        // Save individual category analyses to separate files
        for (const analysis of analyses) {
            const categoryFile = path.join(summaryDir, `${analysis.name.toLowerCase().replace(/ /g, '_')}_summary.md`);
            const categoryContent = `# ${analysis.name} Analysis\n\n` +
                `Analysis of the ${analysis.name} aspects of ${sourcemap.originalFile}\n\n` +
                analysis.content;
            await fs.writeFile(categoryFile, categoryContent);
            console.log(`Saved ${analysis.name} analysis to ${categoryFile}`);
        }
        
        // Combine all analyses into a single document
        const combinedAnalysis = `# LLM Analysis of ${sourcemap.originalFile}\n\n` +
            `**Note**: This is an experimental analysis of a minified JavaScript file. No proprietary code is shared or misused.\n\n` +
            `## Code Structure Overview\n\n` +
            `This file was split into ${chunks.length} components across ${Object.keys(chunksByType).length} different types:\n` +
            `${typeStats.map(stat => `- ${stat.type}: ${stat.count} components`).join('\n')}\n\n` +
            `## Executive Summary\n\n${finalSummary}\n\n` +
            analyses.map(a => `## ${a.name}\n\n${a.content}\n\n`).join('');
        
        await fs.writeFile(outputFile, combinedAnalysis);
        
        // Update metadata with step completion
        const endTime = Date.now();
        const duration = endTime - startTime;
        metadataObj.steps.llmAnalysis.completed = new Date().toISOString();
        metadataObj.steps.llmAnalysis.duration = {
            milliseconds: duration,
            seconds: Math.round(duration / 1000),
            formatted: `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`
        };
        
        // Update metadata file immediately to track progress
        await fs.writeFile(path.join(metadataDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2));
        
        console.log(`Saved multi-category LLM analysis to ${outputFile} (${metadataObj.steps.llmAnalysis.duration.formatted})`);
        return combinedAnalysis;
    } catch (error) {
        console.error(`Failed to generate analysis: ${error.message}`);
        
        // Create a simple error analysis file
        const errorAnalysis = `# LLM Analysis of ${sourcemap.originalFile}\n\n` +
            `**Note**: This is an experimental analysis of a minified JavaScript file. No proprietary code is shared or misused.\n\n` +
            `## Analysis Error\n\n` +
            `The LLM analysis failed with error: ${error.message}\n\n` +
            `## Code Structure\n\n` +
            `This file was split into ${chunks.length} components across ${Object.keys(chunksByType).length} different types:\n` +
            `${typeStats.map(stat => `- ${stat.type}: ${stat.count} components`).join('\n')}\n\n`;
        
        await fs.writeFile(outputFile, errorAnalysis);
        throw error; // Re-throw to let the caller handle it
    }
}

// Run Pipeline
async function runPipeline() {
    console.log('Starting pipeline...');

    try {
        // Initialize LLM based on provider
        const llmProvider = argv.llmProvider || LLM_PROVIDER;
        console.log(`Using LLM provider: ${llmProvider}`);
        
        if (llmProvider === 'vertex') {
            // Load Vertex AI credentials
            vertexCredentials = await loadCredentials();
            
            // Initialize Vertex AI model
            const modelName = argv.llmModel || VERTEX_AI_MODEL;
            console.log(`Initializing Vertex AI with model: ${modelName}`);
            
            llmModel = new ChatVertexAI({
                model: modelName,
                projectId: vertexCredentials?.project_id || 'your-project-id',
                location: VERTEX_AI_LOCATION,
                credentials: vertexCredentials,
                maxOutputTokens: VERTEX_AI_MAX_OUTPUT_TOKENS,
            });
        } else if (llmProvider === 'ollama') {
            // Initialize Ollama client
            const modelName = argv.llmModel || OLLAMA_MODEL;
            const hostUrl = argv.ollamaHost || OLLAMA_HOST;
            console.log(`Initializing Ollama with model: ${modelName} at ${hostUrl}`);
            
            // Create an Ollama client instance
            const ollamaClient = new ollama.Ollama({
                host: hostUrl
            });
            
            llmModel = { 
                client: ollamaClient,
                model: modelName,
                maxTokens: OLLAMA_MAX_TOKENS 
            };
        } else {
            throw new Error(`Unsupported LLM provider: ${llmProvider}`);
        }
        
        // Validate input
        await validateInputFile(inputFile);

        // Create output directories
        // Create all output directories
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(analysisDir, { recursive: true });
await fs.mkdir(metadataDir, { recursive: true });
await fs.mkdir(summariesDir, { recursive: true });
        
        // Write metadata file to help track runs
        await fs.writeFile(
            path.join(outputDir, 'metadata.json'),
            JSON.stringify({
                ...metadataObj,
                startTime: new Date().toISOString()
            }, null, 2)
        );
        console.log(`Saved metadata.json with run information`);
        
        // Run steps
        const prettierCode = await runPrettier(inputFile, prettierOutput);
        const webcrackCode = await runWebcrack(prettierOutput, webcrackOutput);
        const chunks = await runTreeSitter(webcrackCode, treeSitterOutputDir);
        await addJSDocComments(treeSitterOutputDir);
        await generateDependencyGraph(treeSitterOutputDir, path.join(analysisDir, 'dependency_graph.json'));
        // Path for sourcemap - could be in output directory or tree-sitter output directory
        // Try both locations to handle potential variations in file location
        let sourcemapPath;
        try {
            await fs.access(path.join(outputDir, 'sourcemap.json'));
            sourcemapPath = path.join(outputDir, 'sourcemap.json');
        } catch {
            sourcemapPath = path.join(path.dirname(outputDir), 'sourcemap.json');
        }
        
        const dependencyGraphPath = path.join(outputDir, 'dependency_graph.json');
        
        // Skip LLM analysis if requested
        if (!argv.skipLlm) {
            console.log(`Running LLM analysis with provider: ${argv.llmProvider}...`);
            try {
                // Set per-provider timeout for the LLM analysis process
                const perProviderTimeout = llmProvider === 'vertex' ? 300000 : 600000; // 5 min for Vertex, 10 min for Ollama
                console.log(`Setting timeout of ${perProviderTimeout/1000} seconds for ${llmProvider} analysis...`);
                
                const analysisPromise = runLLMAnalysis(
                    treeSitterOutputDir,
                    sourcemapPath,
                    dependencyGraphPath,
                    path.join(analysisDir, 'llm_analysis.md'),
                    chunks
                );
                
                // Set timeout based on provider - Ollama needs more time for sequential calls
                const timeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`LLM analysis timed out after ${perProviderTimeout/1000} seconds`)), perProviderTimeout);
                });
                
                await Promise.race([analysisPromise, timeout]);
            } catch (error) {
                console.error(`LLM analysis failed: ${error.message}`);
                console.log('Continuing with pipeline despite LLM analysis failure...');
                
                // Create a simple analysis file noting the timeout
                const errorAnalysis = `# LLM Analysis of ${path.basename(inputFile)}\n\n` + 
                    `**Note**: LLM analysis failed or timed out: ${error.message}\n\n` +
                    `The pipeline successfully extracted ${chunks.length} code chunks from the file.\n` +
                    `You can find the extracted code in the 3_minified_tree_sitter directory.\n\n` +
                    `To retry the analysis with a different LLM provider or model, use the --llm-provider and --llm-model flags.`;
                
                await fs.writeFile(path.join(analysisDir, 'llm_analysis.md'), errorAnalysis);
            }
        } else {
            console.log('Skipping LLM analysis as requested.');
        }
        await generateReadme();
        
        // Update metadata file with completion information
        try {
            const metadataPath = path.join(metadataDir, 'metadata.json');
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            
            // Calculate total duration
            const endTime = new Date();
            const durationMs = endTime - new Date(metadata.created);
            
            // Update metadata
            metadata.completed = true;
            metadata.updated = endTime.toISOString();
            metadata.duration = {
                milliseconds: durationMs,
                seconds: Math.round(durationMs / 1000),
                formatted: `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
            };
            
            // List all output files
            metadata.outputFiles = {
                raw: {
                    prettier: prettierOutput,
                    webcrack: webcrackOutput,
                    treeSitter: treeSitterOutputDir
                },
                analysis: {
                    llmAnalysis: path.join(analysisDir, 'llm_analysis.md'),
                    dependencyGraph: path.join(analysisDir, 'dependency_graph.json'),
                    sourcemap: path.join(analysisDir, 'sourcemap.json')
                },
                summaries: await listDirectoryFiles(summariesDir),
                metadata: metadataPath
            };
            
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            
            // Also save a copy of the final metadata to the root output directory for easy discovery
            await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
            
            console.log(`Updated metadata.json with completion information`);
        } catch (error) {
            console.warn(`Error updating metadata.json: ${error.message}`);
        }
        
        // Helper function to list all files in a directory
        async function listDirectoryFiles(dir) {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const files = {};
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isFile()) {
                        files[entry.name] = fullPath;
                    }
                }
                
                return files;
            } catch (error) {
                console.warn(`Error listing directory ${dir}: ${error.message}`);
                return {};
            }
        }
        
        console.log('Pipeline complete.');
    } catch (error) {
        console.error('Pipeline failed:', error.message);
        process.exit(1);
    }
}

// Generate README.md
async function generateReadme() {
    const readmeContent = `
# JavaScript Decompiler

**Note**: This is an experimental tool for analyzing minified JavaScript files. It processes a minified .js file (e.g., input/cli.js) for educational purposes only. Ensure you have permission to analyze the input file.

## WHY
To learn more about how to reverse engineer a minified JavaScript file by breaking it into smaller, more manageable files, approximating a source map, and using an LLM to analyze the code.

## Purpose
This script deconstructs a minified JavaScript file into modular components to approximate a source map and generate LLM-based analysis. It processes the input through:
1. **Prettier**: Formats the code for readability.
2. **Webcrack**: Deobfuscates variable names.
3. **Tree-sitter**: Splits code into files by type (functions, classes, etc.).
4. **LLM Analysis**: Uses Google Vertex AI (via LangChain.js) for per-file descriptions.

## Prerequisites
- Node.js v22.15.0 or later
- One of the following LLM providers:
  - Google Vertex AI service account JSON key (in config/vertex_ai_service_account.json)
  - Local Ollama instance running at http://localhost:11435 (or custom host)

## Installation
1. Clone this repository or copy the project files.
2. Initialize a Node.js project (if not already done):
   \`\`\`bash
   npm init -y
   \`\`\`
3. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
   This uses package.json to install prettier, webcrack, tree-sitter, @langchain/google-vertexai, dotenv, yargs, etc.
4. Place your Vertex AI service account JSON key in config/vertex_ai_service_account.json.
5. Create a .env file in the project root:
   \`\`\`env
   VERTEX_AI_CREDENTIALS_PATH=config/vertex_ai_service_account.json
   \`\`\`
6. Add .env, config/vertex_ai_service_account.json, node_modules/, and output/ to .gitignore.

## Project Structure
\`\`\`
project-root/
├── src/                          # Source code
│   ├── deconstruct_pipeline.js   # Main script
│   └── utils/                   # Utility modules (optional)
├── config/                      # Configuration files
│   ├── .env                     # Environment variables
│   └── vertex_ai_service_account.json # Vertex AI credentials
├── input/                       # Input files
│   └── cli.js                   # Example minified JS
├── output/                      # Output directory
│   └── deconstructed_output/    # Generated files
├── tests/                       # Test files (optional)
│   └── deconstruct_pipeline.test.js # Placeholder
├── .gitignore                   # Git ignore file
├── package.json                 # Dependencies and scripts
├── README.md                    # Documentation
└── .eslintrc.json               # ESLint configuration (optional)
\`\`\`

## Usage
Run the script with a minified JavaScript file:
\`\`\`bash
node src/deconstruct_pipeline.js <input_file> [--output-dir <path>] [--llm-provider <provider>] [--llm-model <model>] [--skip-llm]
\`\`\`

Examples:
\`\`\`bash
# Using Google Vertex AI (default)
node src/deconstruct_pipeline.js input/cli.js --output-dir output/custom

# Using local Ollama instance
node src/deconstruct_pipeline.js input/cli.js --llm-provider ollama --llm-model qwen3:30b-a3b-q8_0

# Skip LLM analysis (faster for testing)
node src/deconstruct_pipeline.js input/cli.js --skip-llm
\`\`\`

Run \`node src/deconstruct_pipeline.js --help\` for all options.

## Expected Input
Minified JavaScript files with:
- Short variable names (e.g., zZ6, QZ6, J1, A)
- No whitespace or comments
- Compressed syntax (e.g., \`import{createRequire as zZ6}from"node:module";var QZ6=Object.create;...\`)

## Output Structure
The script creates a directory (default: output/deconstructed_output/) with:
- \`1_minified_prettier.js\`: Formatted code.
- \`2_minified_webcrack.js\`: Deobfuscated code.
- \`3_minified_tree_sitter/\`: Modular files in subdirectories:
  - \`functions/\`: Function declarations/methods.
  - \`classes/\`: Class declarations.
  - \`imports/\`: Import statements.
  - \`exports/\`: Export statements.
  - \`variables/\`: Variable declarations.
  - \`constants/\`: Const/let declarations.
  - \`base/\`: Miscellaneous code.
- \`sourcemap.json\`: Maps files to original line numbers.
- \`dependency_graph.json\`: File relationships.
- \`llm_analysis.md\`: LLM descriptions for each file.
- \`README.md\`: This file.

## Example Output
\`\`\`
output/deconstructed_output/
├── 1_minified_prettier.js
├── 2_minified_webcrack.js
├── 3_minified_tree_sitter/
│   ├── functions/
│   │   ├── module_helper.js
│   │   ├── another_function.js
│   ├── imports/
│   │   ├── import_createRequire.js
│   ├── base/
│   │   ├── base.js
├── sourcemap.json
├── dependency_graph.json
├── llm_analysis.md
├── README.md
\`\`\`

## Notes
- The LLM analysis requires a Google Vertex AI service account JSON key (see https://cloud.google.com/vertex-ai/docs).
- The script assumes the input is a valid minified JavaScript file.
- For large files, monitor memory usage during Tree-sitter parsing.
- Use .env for secure credential path storage with dotenv.
  `;
    // Save README.md in both the output directory and the analysis directory
await fs.writeFile(path.join(outputDir, 'README.md'), readmeContent);
await fs.writeFile(path.join(analysisDir, 'README.md'), readmeContent);
    console.log(`Saved README.md`);
}

// Execute pipeline
runPipeline().catch((err) => console.error('Pipeline error:', err));