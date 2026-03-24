#!/bin/bash

# Remove Next.js cache and build files
rm -rf .next
rm -rf node_modules/.pnpm
rm -rf node_modules/.bin
rm -rf node_modules/bcrypt

echo "Cache cleared. Please run: pnpm install"
