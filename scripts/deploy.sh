#!/bin/bash
# Deploy to GitHub Pages
# Usage: bash scripts/deploy.sh
#
# Prerequisites:
#   1. GitHub repo created (gh repo create or manually)
#   2. Remote 'origin' set up
#   3. Node.js installed

set -e

echo "=== Pokemon Ecosystem Simulator — Deploy to GitHub Pages ==="
echo ""

# Step 1: Export static data from simulation
echo "Step 1: Exporting simulation data..."
cd services/simulation
python ../../scripts/export_static.py
cd ../..

# Step 2: Build frontend
echo ""
echo "Step 2: Building frontend..."
cd frontend
GITHUB_PAGES=1 npx vite build
cd ..

# Step 3: Deploy to gh-pages branch
echo ""
echo "Step 3: Deploying to GitHub Pages..."
cd frontend
npx gh-pages -d dist
cd ..

echo ""
echo "=== Deployed! ==="
echo "Your site will be live at: https://<username>.github.io/pokemon-ecosystem-simulator/"
echo "It may take 1-2 minutes for GitHub to update."
