#!/usr/bin/env node
/**
 * Script to compact/compress image assets in a given folder.
 *
 * Scans the specified folder for image files (PNG, JPG, JPEG, WEBP) and compresses
 * them to reduce file size while maintaining visual quality.
 *
 * Requires: sharp (install with: pnpm add -D sharp)
 *
 * Usage:
 *   node scripts/compact-assets.mjs <target-folder> [options]
 *   node scripts/compact-assets.mjs --target=<folder> [options]
 *
 * Options:
 *   --target=<folder>      Target folder to process (required if not provided as positional arg)
 *   --quality=<number>     Compression quality (0-100). Default: 85
 *   --min-size=<size>      Only compress files larger than this (e.g., "100KB", "500KB")
 *   --dry-run              Perform compression and report savings, then restore originals
 *   --backup               Create backup files before compression
 *   --exclude-dirs         Comma-separated list of directories to exclude
 *   --formats              Comma-separated list of formats to compress (png,jpg,jpeg,webp). Default: png,jpg,jpeg,webp
 *
 * Note: Place a .no-compress file in any directory to skip compression for that
 *       directory and all its subdirectories.
 */

import {
  readdir,
  stat,
  copyFile,
  writeFile,
  unlink,
  mkdir,
  access,
} from "fs/promises";
import { join, relative, extname, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { constants } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

// Image file extensions that can be compressed
const COMPRESSIBLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Parse size string like "500KB", "1MB", "2.5MB" to bytes
function parseSize(sizeStr) {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)?$/i);
  if (!match) {
    throw new Error(
      `Invalid size format: ${sizeStr}. Use format like "500KB" or "1MB"`,
    );
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();

  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  return Math.floor(value * multipliers[unit]);
}

// Format bytes to human-readable string
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Check if a directory or any parent contains a .no-compress file
async function hasNoCompressFile(dirPath, rootDir) {
  let currentDir = dirPath;

  while (currentDir !== rootDir && currentDir.length > rootDir.length) {
    const noCompressPath = join(currentDir, ".no-compress");
    try {
      await access(noCompressPath, constants.F_OK);
      return true;
    } catch {
      // File doesn't exist, continue checking parent
    }
    currentDir = dirname(currentDir);
  }

  // Check root directory as well
  const rootNoCompressPath = join(rootDir, ".no-compress");
  try {
    await access(rootNoCompressPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Recursively find all compressible image files
async function findImageFiles(
  dir,
  excludeDirs,
  allowedFormats,
  rootDir,
  files = [],
) {
  // Check if this directory should be skipped due to .no-compress
  if (await hasNoCompressFile(dir, rootDir)) {
    return files;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(rootDir, fullPath);

    // Skip excluded directories
    if (excludeDirs.some((exclude) => relativePath.includes(exclude))) {
      continue;
    }

    if (entry.isDirectory()) {
      await findImageFiles(
        fullPath,
        excludeDirs,
        allowedFormats,
        rootDir,
        files,
      );
    } else if (entry.isFile()) {
      // Skip .no-compress files themselves
      if (entry.name === ".no-compress") {
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      if (allowedFormats.has(ext)) {
        // Double-check that the file's directory isn't marked with .no-compress
        if (!(await hasNoCompressFile(dir, rootDir))) {
          const stats = await stat(fullPath);
          files.push({
            path: relativePath,
            fullPath,
            size: stats.size,
            ext: ext.substring(1).toUpperCase(),
          });
        }
      }
    }
  }

  return files;
}

// Ensure directory exists (recursively)
async function ensureDir(dirPath) {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory might already exist, which is fine
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

// Compress an image file using sharp
async function compressImage(
  filePath,
  quality,
  backup,
  dryRun,
  outputDir,
  rootDir,
) {
  const ext = extname(filePath).toLowerCase();
  const originalStats = await stat(filePath);
  const originalSize = originalStats.size;

  // Create backup if requested (for both backup mode and dry-run mode)
  const backupPath = `${filePath}.backup`;
  if (backup || dryRun) {
    await copyFile(filePath, backupPath);
  }

  // Use sharp for raster images
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    throw new Error(
      "sharp is not installed. Install it with: pnpm add -D sharp",
    );
  }

  // Read and compress the image
  const image = sharp(filePath);
  const metadata = await image.metadata();

  let compressedBuffer;
  if (ext === ".png") {
    // PNG compression
    compressedBuffer = await image
      .png({ quality, compressionLevel: 9 })
      .toBuffer();
  } else if (ext === ".jpg" || ext === ".jpeg") {
    // JPEG compression
    compressedBuffer = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
  } else if (ext === ".webp") {
    // WebP compression
    compressedBuffer = await image.webp({ quality }).toBuffer();
  } else {
    throw new Error(`Unsupported format: ${ext}`);
  }

  const compressedSize = compressedBuffer.length;
  const savings = originalSize - compressedSize;
  const savingsPercent = ((savings / originalSize) * 100).toFixed(1);

  // Only write if we actually saved space
  if (compressedSize < originalSize) {
    if (!dryRun) {
      // In normal mode, write the compressed file
      await writeFile(filePath, compressedBuffer);
    } else {
      // In dry-run mode, save compressed version to output directory
      if (outputDir) {
        const relativePath = relative(rootDir, filePath);
        const outputPath = join(outputDir, relativePath);
        const outputDirPath = dirname(outputPath);
        await ensureDir(outputDirPath);
        await writeFile(outputPath, compressedBuffer);
      }
      // Restore the original and clean up backup
      await copyFile(backupPath, filePath);
      await unlink(backupPath);
    }
    return {
      success: true,
      originalSize,
      compressedSize,
      savings,
      savingsPercent,
      outputPath:
        dryRun && outputDir
          ? relative(rootDir, join(outputDir, relative(rootDir, filePath)))
          : null,
    };
  } else {
    // If compressed version wasn't smaller, restore original
    if (backup || dryRun) {
      await copyFile(backupPath, filePath);
      await unlink(backupPath);
    }
    return {
      success: false,
      originalSize,
      compressedSize: originalSize,
      savings: 0,
      savingsPercent: "0.0",
      reason: "Compressed version was not smaller",
    };
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    target: null,
    files: [],
    quality: 85,
    minSize: "0B",
    dryRun: false,
    backup: false,
    excludeDirs: ["node_modules", ".git", "dist"],
    formats: ["png", "jpg", "jpeg", "webp"],
  };

  const positionalArgs = [];

  for (const arg of args) {
    if (arg.startsWith("--target=")) {
      options.target = arg.substring("--target=".length);
    } else if (arg.startsWith("--quality=")) {
      options.quality = parseInt(arg.substring("--quality=".length), 10);
      if (
        isNaN(options.quality) ||
        options.quality < 0 ||
        options.quality > 100
      ) {
        throw new Error("Quality must be a number between 0 and 100");
      }
    } else if (arg.startsWith("--min-size=")) {
      options.minSize = arg.substring("--min-size=".length);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--backup") {
      options.backup = true;
    } else if (arg.startsWith("--exclude-dirs=")) {
      options.excludeDirs = arg
        .substring("--exclude-dirs=".length)
        .split(",")
        .map((d) => d.trim());
    } else if (arg.startsWith("--formats=")) {
      options.formats = arg
        .substring("--formats=".length)
        .split(",")
        .map((f) => f.trim().toLowerCase());
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/compact-assets.mjs <target-folder> [options]
       node scripts/compact-assets.mjs --target=<folder> [options]
       node scripts/compact-assets.mjs <file1> [file2] [file3] ... [options]

Options:
  --target=<folder>      Target folder to process (required if not provided as positional arg)
  --quality=<number>     Compression quality (0-100). Default: 85
  --min-size=<size>      Only compress files larger than this (e.g., "100KB", "500KB")
                         Default: 0B (compress all files)
  --dry-run              Perform compression and report savings, then restore originals
  --backup               Create backup files (.backup) before compression
  --exclude-dirs=<dirs>  Comma-separated list of directories to exclude
                         Default: node_modules,.git,dist
  --formats=<formats>    Comma-separated list of formats to compress
                         Default: png,jpg,jpeg,webp
                         Note: Use scripts/optimize-svgs.mjs for SVG files
  --help, -h             Show this help message

Note: Place a .no-compress file in any directory to skip compression for that
      directory and all its subdirectories.

Examples:
  # Compress all images in a folder
  node scripts/compact-assets.mjs packages/tiles
  node scripts/compact-assets.mjs --target=packages/tiles --quality=80 --min-size=100KB
  
  # Compress specific files
  node scripts/compact-assets.mjs packages/tiles/image1.png packages/tiles/image2.jpg
  node scripts/compact-assets.mjs packages/tiles/image1.png --quality=90 --backup
  
  # Dry run on folder
  node scripts/compact-assets.mjs packages/tiles --dry-run --min-size=500KB
      `);
      process.exit(0);
    } else if (!arg.startsWith("--")) {
      // Positional argument (target folder or file)
      positionalArgs.push(arg);
    }
  }

  // If --target is provided, use it; otherwise use positional args
  if (options.target) {
    // If target is set, positional args are ignored
  } else if (positionalArgs.length > 0) {
    // If multiple positional args, treat as files; if one, could be folder or file
    if (positionalArgs.length === 1) {
      options.target = positionalArgs[0];
    } else {
      options.files = positionalArgs;
    }
  }

  if (!options.target && options.files.length === 0) {
    throw new Error(
      "Target folder or file(s) required. Use --target=<folder>, provide a folder as positional argument, or provide one or more files as positional arguments.",
    );
  }

  return options;
}

// Main function
async function main() {
  const options = parseArgs();
  const minSizeBytes = parseSize(options.minSize);
  const allowedFormats = new Set(
    options.formats.map((f) => (f.startsWith(".") ? f : `.${f}`)),
  );

  // Validate formats
  for (const format of allowedFormats) {
    if (!COMPRESSIBLE_EXTENSIONS.has(format)) {
      throw new Error(
        `Unsupported format: ${format}. Supported formats: ${Array.from(COMPRESSIBLE_EXTENSIONS).join(", ")}`,
      );
    }
  }

  let targetFolder;
  let allImages = [];
  let imagesToCompress = [];

  // Handle file mode vs folder mode
  if (options.files.length > 0) {
    // File mode: process specific files
    console.error("=".repeat(80));
    console.error("ASSET COMPACTION SCRIPT (FILE MODE)");
    console.error("=".repeat(80));
    console.error(`Files to process: ${options.files.length}`);
    console.error(`Quality: ${options.quality}`);
    console.error(
      `Minimum size: ${options.minSize} (${formatBytes(minSizeBytes)})`,
    );
    console.error(`Dry run: ${options.dryRun ? "YES" : "NO"}`);
    console.error(`Backup: ${options.backup ? "YES" : "NO"}`);
    console.error(`Formats: ${options.formats.join(", ")}`);
    console.error("=".repeat(80));
    console.error("Processing files...\n");

    // Resolve all files and validate them
    const resolvedFiles = [];
    for (const filePath of options.files) {
      const resolvedPath = resolve(filePath);
      try {
        const fileStats = await stat(resolvedPath);
        if (!fileStats.isFile()) {
          throw new Error(`Path exists but is not a file: ${resolvedPath}`);
        }

        const ext = extname(resolvedPath).toLowerCase();
        if (!allowedFormats.has(ext)) {
          console.error(
            `Warning: Skipping ${filePath} - not a supported format (${ext})`,
          );
          continue;
        }

        resolvedFiles.push({
          path: filePath,
          fullPath: resolvedPath,
          size: fileStats.size,
          ext: ext.substring(1).toUpperCase(),
        });
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(`File does not exist: ${resolvedPath}`);
        }
        throw error;
      }
    }

    if (resolvedFiles.length === 0) {
      console.log("No valid image files to compress.");
      return;
    }

    allImages = resolvedFiles;
    // For file mode, use REPO_ROOT as the base directory for relative paths
    targetFolder = REPO_ROOT;
  } else {
    // Folder mode: scan directory recursively
    targetFolder = resolve(options.target);

    // Validate that target folder exists and is a directory
    try {
      const targetStats = await stat(targetFolder);
      if (!targetStats.isDirectory()) {
        throw new Error(
          `Target path exists but is not a directory: ${targetFolder}`,
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Target folder does not exist: ${targetFolder}`);
      }
      throw error;
    }

    console.error("=".repeat(80));
    console.error("ASSET COMPACTION SCRIPT");
    console.error("=".repeat(80));
    console.error(`Target folder: ${targetFolder}`);
    console.error(`Quality: ${options.quality}`);
    console.error(
      `Minimum size: ${options.minSize} (${formatBytes(minSizeBytes)})`,
    );
    console.error(`Dry run: ${options.dryRun ? "YES" : "NO"}`);
    console.error(`Backup: ${options.backup ? "YES" : "NO"}`);
    console.error(`Excluding directories: ${options.excludeDirs.join(", ")}`);
    console.error(`Formats: ${options.formats.join(", ")}`);
    console.error(
      `Note: Directories containing .no-compress files will be skipped`,
    );
    console.error("=".repeat(80));
    console.error("Scanning for image files...\n");

    allImages = await findImageFiles(
      targetFolder,
      options.excludeDirs,
      allowedFormats,
      targetFolder,
    );
  }

  // Filter by minimum size
  imagesToCompress = allImages.filter((img) => img.size >= minSizeBytes);

  if (options.files.length === 0) {
    console.error(`Found ${allImages.length} image files`);
    console.error(
      `${imagesToCompress.length} files meet the minimum size threshold\n`,
    );
  } else {
    console.error(
      `${imagesToCompress.length} of ${allImages.length} files meet the minimum size threshold\n`,
    );
  }

  if (imagesToCompress.length === 0) {
    console.log("No files to compress.");
    return;
  }

  // Set up output directory for dry-run mode
  let outputDir = null;
  if (options.dryRun) {
    const COMPACTED_ASSETS_DIR = join(targetFolder, ".compacted-assets");
    outputDir = COMPACTED_ASSETS_DIR;
    await ensureDir(outputDir);
    console.log("DRY RUN MODE - Files will be compressed and then restored");
    console.log(
      `Compressed versions will be saved to: ${relative(REPO_ROOT, outputDir)}\n`,
    );
  }

  // Compress files
  const results = [];
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;
  let successCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < imagesToCompress.length; i++) {
    const img = imagesToCompress[i];
    const progress = `[${i + 1}/${imagesToCompress.length}]`;
    const mode = options.dryRun ? " (dry-run)" : "";
    process.stderr.write(`${progress} Compressing ${img.path}${mode}... `);

    try {
      const result = await compressImage(
        img.fullPath,
        options.quality,
        options.backup,
        options.dryRun,
        outputDir,
        targetFolder,
      );
      totalOriginalSize += result.originalSize;
      totalCompressedSize += result.compressedSize;

      if (result.success) {
        successCount++;
        process.stderr.write(
          `✓ Saved ${formatBytes(result.savings)} (${result.savingsPercent}%)\n`,
        );
        results.push({
          ...img,
          ...result,
        });
      } else {
        skippedCount++;
        process.stderr.write(`⊘ ${result.reason}\n`);
        results.push({
          ...img,
          ...result,
        });
      }
    } catch (error) {
      skippedCount++;
      process.stderr.write(`✗ Error: ${error.message}\n`);
      results.push({
        ...img,
        success: false,
        error: error.message,
      });
    }
  }

  // Print summary
  const totalSavings = totalOriginalSize - totalCompressedSize;
  const totalSavingsPercent =
    totalOriginalSize > 0
      ? ((totalSavings / totalOriginalSize) * 100).toFixed(1)
      : "0.0";

  console.log("\n" + "=".repeat(80));
  if (options.dryRun) {
    console.log("DRY RUN COMPRESSION SUMMARY");
    console.log("(Files were compressed and then restored to original)");
  } else {
    console.log("COMPRESSION SUMMARY");
  }
  console.log("=".repeat(80));
  console.log(`Files processed: ${imagesToCompress.length}`);
  console.log(`Successfully compressed: ${successCount}`);
  console.log(`Skipped/failed: ${skippedCount}`);
  console.log(`Total original size: ${formatBytes(totalOriginalSize)}`);
  console.log(`Total compressed size: ${formatBytes(totalCompressedSize)}`);
  console.log(
    `Total savings: ${formatBytes(totalSavings)} (${totalSavingsPercent}%)`,
  );

  if (successCount > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("COMPRESSED FILES:");
    console.log("-".repeat(80));
    for (const result of results) {
      if (result.success) {
        const outputInfo = result.outputPath ? ` → ${result.outputPath}` : "";
        console.log(
          `${formatBytes(result.savings).padStart(10)} saved  ${result.ext.padEnd(4)}  ${result.path}${outputInfo}`,
        );
      }
    }
  }

  if (options.backup && !options.dryRun) {
    console.log("\n" + "-".repeat(80));
    console.log(
      `Backup files created with .backup extension. Remove them after verifying compression.`,
    );
  }

  if (options.dryRun) {
    console.log("\n" + "-".repeat(80));
    console.log(
      `DRY RUN: All original files have been restored to their original state.`,
    );
    console.log(
      `Compressed versions are available in: ${relative(REPO_ROOT, outputDir)}`,
    );
    console.log(
      `You can visually compare the original and compressed versions there.`,
    );
  }

  console.log("=".repeat(80));
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
