# JSReverse Developer Guide

This document provides information for developers working on the JSReverse project.

## Project Structure

```
jsreverse/
├── src/                          # Source code
│   ├── deconstruct_pipeline.js   # Main script
│   └── utils/                    # Utility modules
│       └── helpers.js            # Helper functions
├── configs/                      # Configuration files
│   ├── .env                      # Environment variables
│   └── vertex_ai_service_account.json # Vertex AI credentials
├── input/                        # Input files
│   └── cli.js                    # Example minified JS
├── output/                       # Output directory
│   └── deconstructed_output/     # Generated files
├── tests/                        # Test files
│   └── deconstruct_pipeline.test.js
├── .gitignore                    # Git ignore file
├── eslint.config.js              # ESLint configuration
├── jest.config.js                # Jest configuration
├── package.json                  # Dependencies and scripts
└── README.md                     # User documentation
```

## Development Environment Setup

1. Install Node.js 18.x or later
2. Clone the repository
3. Install dependencies:
   ```bash
   npm install
   ```
4. Set up Vertex AI credentials:
   - Create a service account in Google Cloud Console
   - Download the JSON key
   - Save it as `configs/vertex_ai_service_account.json`
   - Create a `.env` file in the `configs` directory with:
     ```
     VERTEX_AI_CREDENTIALS_PATH=configs/vertex_ai_service_account.json
     GOOGLE_APPLICATION_CREDENTIALS=configs/vertex_ai_service_account.json
     ```

## Available Scripts

- `npm start <input_file> [--output-dir <path>]` - Run the pipeline
- `npm test` - Run Jest tests
- `npm run test:watch` - Run Jest tests in watch mode
- `npm run test:coverage` - Run Jest tests with coverage report
- `npm run lint` - Run ESLint to check code quality
- `npm run lint:fix` - Run ESLint and fix issues automatically
- `npm run validate` - Run validation tests for utility functions

## Development Workflow

1. Create a new branch for your feature or bugfix
2. Make your changes
3. Write tests for your changes
4. Run tests with `npm test`
5. Run linting with `npm run lint`
6. Submit a pull request

## Coding Standards

- Use ES6+ features
- Follow ESLint rules
- Write JSDoc comments for all functions
- Write unit tests for all new functionality
- Keep functions small and focused on a single responsibility
- Use utility functions from `src/utils/helpers.js` where appropriate

## Architecture

The pipeline follows these steps:

1. **Prettier**: Formats minified code for readability
2. **Webcrack**: Deobfuscates variable names
3. **Tree-sitter**: Parses code into modular files (functions, classes, etc.)
4. **JSDoc**: Adds JSDoc comments to functions
5. **Dependency Graph**: Creates a dependency graph of the code
6. **LLM Analysis**: Uses Vertex AI to analyze each file

## Debugging

To debug the pipeline, use:

```bash
NODE_DEBUG=jsreverse node src/deconstruct_pipeline.js <input_file>
```

## Adding New Features

When adding new features:

1. Update utility functions in `src/utils/helpers.js` if needed
2. Add unit tests in `tests/`
3. Update documentation in README.md
4. Update this developer guide if necessary

## Troubleshooting

- **Error: Failed to load credentials**: Check that the path in `.env` is correct and the file exists
- **Error: Invalid JSON**: Check that the vertex_ai_service_account.json file is valid
- **Error: Cannot find module**: Run `npm install` to install dependencies
- **Error: Input file does not exist**: Check that the input file path is correct