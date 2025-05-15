/**
 * Cleanup utility for output directories
 * 
 * Helps identify and clean up old output directories that are no longer needed.
 * Provides sorting by date, size, input file, and completion status to help determine which outputs to keep or delete.
 * 
 * Features:
 * - Lists directories with timestamps and metadata
 * - Sorts by date, size, or input file
 * - Filters by status (completed/incomplete)
 * - Retains N most recent directories
 * - Removes directories older than X days
 * - Keeps at least N directories per input file
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Lists output directories with their metadata, sorted by specified criteria
 * 
 * @param {string} outputDir - Base output directory
 * @param {Object} options - Options for listing
 *   @param {string} [options.sortBy='date'] - Sort criteria ('date', 'size', 'input')
 *   @param {boolean} [options.completedOnly=false] - Only show completed runs
 *   @param {string} [options.inputFilter] - Filter by input file basename
 * @returns {Promise<Array>} - Array of output directories with metadata
 */
async function listOutputDirectories(outputDir = 'output', options = {}) {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory());
    
    const dirStats = [];
    
    for (const dir of dirs) {
        const fullPath = path.join(outputDir, dir.name);
        try {
            // Try to read metadata file
            const metadataPath = path.join(fullPath, 'metadata.json');
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            
            // Calculate size of directory
            let totalSize = 0;
            async function getDirectorySize(dirPath) {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const entryPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        await getDirectorySize(entryPath);
                    } else {
                        const stats = await fs.stat(entryPath);
                        totalSize += stats.size;
                    }
                }
            }
            
            await getDirectorySize(fullPath);
            
            dirStats.push({
                name: dir.name,
                path: fullPath,
                metadata,
                size: totalSize,
                created: new Date(metadata.timestamp || 0)
            });
        } catch (error) {
            // Directory doesn't have metadata, use filesystem stats
            try {
                const stats = await fs.stat(fullPath);
                
                // Calculate size of directory
                let totalSize = 0;
                async function getDirectorySize(dirPath) {
                    try {
                        const entries = await fs.readdir(dirPath, { withFileTypes: true });
                        
                        for (const entry of entries) {
                            const entryPath = path.join(dirPath, entry.name);
                            if (entry.isDirectory()) {
                                await getDirectorySize(entryPath);
                            } else {
                                const stats = await fs.stat(entryPath);
                                totalSize += stats.size;
                            }
                        }
                    } catch (error) {
                        console.warn(`Error calculating size for ${dirPath}: ${error.message}`);
                    }
                }
                
                await getDirectorySize(fullPath);
                
                dirStats.push({
                    name: dir.name,
                    path: fullPath,
                    metadata: null,
                    size: totalSize,
                    created: stats.mtime
                });
            } catch (error) {
                console.warn(`Could not get stats for ${fullPath}: ${error.message}`);
                dirStats.push({
                    name: dir.name,
                    path: fullPath,
                    metadata: null,
                    size: 0,
                    created: new Date(0)
                });
            }
        }
    }
    
    // Filter by completion status if requested
    let filteredDirs = [...dirStats];
    
    if (options.completedOnly) {
        filteredDirs = filteredDirs.filter(dir => dir.metadata && dir.metadata.completed === true);
    }

    // Filter by input file if requested
    if (options.inputFilter) {
        filteredDirs = filteredDirs.filter(dir => {
            const inputFile = dir.metadata && dir.metadata.inputBaseName;
            return inputFile && inputFile.includes(options.inputFilter);
        });
    }

    // Sort based on criteria
    switch (options.sortBy) {
        case 'size':
            filteredDirs.sort((a, b) => b.size - a.size);
            break;
        case 'input':
            // Sort by input file name, then by date
            filteredDirs.sort((a, b) => {
                const fileA = (a.metadata && a.metadata.inputBaseName) || '';
                const fileB = (b.metadata && b.metadata.inputBaseName) || '';
                return fileA.localeCompare(fileB) || b.created - a.created;
            });
            break;
        default: // 'date' is default
            filteredDirs.sort((a, b) => b.created - a.created);
            break;
    }
    
    return filteredDirs;
}

/**
 * Removes directories based on various criteria
 * 
 * @param {string} outputDir - Base output directory
 * @param {Object} options - Options for cleanup
 *   @param {number} [options.olderThan=7] - Remove directories older than this many days
 *   @param {boolean} [options.dryRun=true] - If true, don't actually delete anything
 *   @param {number} [options.keepMin=5] - Always keep this many directories (newest first)
 *   @param {number} [options.keepMinPerInput=2] - Always keep this many directories per input file
 *   @param {boolean} [options.keepCompleted=true] - Always keep completed runs
 * @returns {Promise<Object>} - Results of the cleanup operation
 */
async function cleanupOldDirectories(outputDir = 'output', options = {}) {
    const { 
        olderThan = 7, 
        dryRun = true, 
        keepMin = 5,
        keepMinPerInput = 2,
        keepCompleted = true
    } = options;
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThan);
    
    // Get all directories
    const allDirs = await listOutputDirectories(outputDir);
    
    // Track which directories to keep
    const toKeep = new Set();
    
    // Step 1: Always keep the newest keepMin directories
    allDirs.slice(0, keepMin).forEach(dir => toKeep.add(dir.path));
    
    // Step 2: Keep directories per input file if specified
    if (keepMinPerInput > 0) {
        // Group by input file
        const dirsByInput = {};
        
        for (const dir of allDirs) {
            const inputFile = dir.metadata?.inputBaseName || 'unknown';
            if (!dirsByInput[inputFile]) {
                dirsByInput[inputFile] = [];
            }
            dirsByInput[inputFile].push(dir);
        }
        
        // Keep newest N directories for each input file
        Object.values(dirsByInput).forEach(dirs => {
            // Sort by date (newest first)
            dirs.sort((a, b) => b.created - a.created);
            
            // Keep the newest keepMinPerInput directories
            dirs.slice(0, keepMinPerInput).forEach(dir => toKeep.add(dir.path));
        });
    }
    
    // Step 3: Keep completed runs if specified
    if (keepCompleted) {
        allDirs.filter(dir => dir.metadata && dir.metadata.completed === true)
              .forEach(dir => toKeep.add(dir.path));
    }
    
    // Find directories to remove (older than cutoff and not in toKeep)
    const oldDirs = allDirs.filter(dir => 
        dir.created < cutoffDate && !toKeep.has(dir.path)
    );
    
    // Keep track of what we're keeping explicitly
    const keptDirs = allDirs.filter(dir => toKeep.has(dir.path));
    
    if (dryRun) {
        return {
            wouldRemove: oldDirs,
            kept: keptDirs
        };
    }
    
    // Remove old directories
    const removed = [];
    for (const dir of oldDirs) {
        try {
            await fs.rm(dir.path, { recursive: true });
            removed.push(dir);
        } catch (error) {
            console.error(`Error removing ${dir.path}: ${error.message}`);
        }
    }
    
    return {
        removed,
        kept: keptDirs
    };
}

// Print directory information
function formatDirectoryInfo(dir) {
    const size = (dir.size / (1024 * 1024)).toFixed(2);
    const date = dir.created.toISOString().replace('T', ' ').substring(0, 19);
    
    let metadataInfo = 'No metadata';
    if (dir.metadata) {
        const status = dir.metadata.completed ? '✅ Completed' : '⏳ Incomplete';
        const duration = dir.metadata.duration?.formatted || 'Unknown';
        const provider = dir.metadata.llmProvider || 'Unknown';
        const model = dir.metadata.llmModel || 'Unknown';
        const inputFile = dir.metadata.inputBaseName || 'Unknown';
        
        metadataInfo = `Status: ${status}, Duration: ${duration}\n  Input: ${inputFile}\n  Provider: ${provider}, Model: ${model}`;
    }
    
    return `${dir.name}\n  Created: ${date}\n  Size: ${size} MB\n  ${metadataInfo}\n`;
}

// Command-line functionality
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (command === 'list') {
        // Parse list options
        let sortBy = 'date'; // default
        if (args.includes('--size')) sortBy = 'size';
        if (args.includes('--input')) sortBy = 'input';
        
        const completedOnly = args.includes('--completed-only');
        
        // Get input filter if provided
        const filterArg = args.find(a => a.startsWith('--filter='));
        const inputFilter = filterArg ? filterArg.split('=')[1] : '';
        
        console.log(`Listing output directories sorted by ${sortBy}${completedOnly ? ' (completed only)' : ''}${inputFilter ? ` filtered by "${inputFilter}"` : ''}:\n`);
        
        const dirs = await listOutputDirectories('output', { 
            sortBy, 
            completedOnly,
            inputFilter 
        });
        
        if (dirs.length === 0) {
            console.log('No output directories found matching criteria.');
            return;
        }
        
        dirs.forEach((dir, i) => {
            console.log(`${i + 1}. ${formatDirectoryInfo(dir)}`);
        });
    } else if (command === 'cleanup') {
        const dryRun = !args.includes('--force');
        const olderThan = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '7', 10);
        const keepMin = parseInt(args.find(a => a.startsWith('--keep='))?.split('=')[1] || '5', 10);
        const keepMinPerInput = parseInt(args.find(a => a.startsWith('--keep-per-input='))?.split('=')[1] || '2', 10);
        const keepCompleted = !args.includes('--allow-delete-completed');
        
        console.log(`${dryRun ? 'Simulating cleanup' : 'Cleaning up'} of directories older than ${olderThan} days.`);
        console.log(`Keeping at least ${keepMin} newest directories overall.`);
        console.log(`Keeping at least ${keepMinPerInput} newest directories per input file.`);
        console.log(`${keepCompleted ? 'Keeping' : 'Allowing deletion of'} completed runs.`);
        
        const result = await cleanupOldDirectories('output', { 
            olderThan, 
            dryRun, 
            keepMin,
            keepMinPerInput,
            keepCompleted 
        });
        
        if (dryRun) {
            console.log(`Would keep the following directories:`);
            result.kept.forEach((dir, i) => {
                console.log(`${i + 1}. ${formatDirectoryInfo(dir)}`);
            });
            
            console.log(`\nWould remove the following directories:`);
            if (result.wouldRemove.length === 0) {
                console.log('  None');
            } else {
                result.wouldRemove.forEach((dir, i) => {
                    console.log(`${i + 1}. ${formatDirectoryInfo(dir)}`);
                });
            }
            console.log('\nTo actually remove these directories, run with --force');
        } else {
            console.log(`Kept the following directories:`);
            result.kept.forEach((dir, i) => {
                console.log(`${i + 1}. ${formatDirectoryInfo(dir)}`);
            });
            
            console.log(`\nRemoved the following directories:`);
            if (result.removed.length === 0) {
                console.log('  None');
            } else {
                result.removed.forEach((dir, i) => {
                    console.log(`${i + 1}. ${formatDirectoryInfo(dir)}`);
                });
            }
        }
    } else {
        console.log(`
Usage:
  node cleanup_outputs.js list [options]      List output directories with various sorting options
  node cleanup_outputs.js cleanup [options]   Clean up old output directories

Options for list:
  --size                  Sort by directory size
  --input                 Sort by input file name
  --completed-only        Only show completed runs
  --filter=PATTERN        Filter by input file name

Options for cleanup:
  --days=N                Remove directories older than N days (default: 7)
  --keep=N                Always keep N newest directories overall (default: 5)
  --keep-per-input=N      Keep N newest directories per input file (default: 2)
  --allow-delete-completed Allow deletion of completed runs (default: keep all completed)
  --force                 Actually delete directories (without this, just shows what would be deleted)
        `);
    }
}

// Run main when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export {
    listOutputDirectories,
    cleanupOldDirectories
};