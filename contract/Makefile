# ZetaGacha Contract Makefile

# Load environment variables
include .env
export

# Default target
.PHONY: help
help:
	@echo "ZetaGacha Contract Commands:"
	@echo "  build          - Compile contracts"
	@echo "  test           - Run tests"
	@echo "  test-verbose   - Run tests with verbose output"
	@echo "  deploy-testnet - Deploy to ZetaChain testnet"
	@echo "  deploy-mainnet - Deploy to ZetaChain mainnet"
	@echo "  seed-pool      - Seed the prize pool"
	@echo "  status         - Check contract status"
	@echo "  clean          - Clean build artifacts"

# Build contracts
.PHONY: build
build:
	forge build

# Run tests
.PHONY: test
test:
	forge test

# Run tests with verbose output
.PHONY: test-verbose
test-verbose:
	forge test -vvv

# Deploy to testnet
.PHONY: deploy-testnet
deploy-testnet:
	forge script script/Deploy.s.sol --rpc-url $(ZETA_TESTNET_RPC) --broadcast --verify

# Deploy to mainnet
.PHONY: deploy-mainnet
deploy-mainnet:
	@echo "⚠️  WARNING: Deploying to MAINNET!"
	@echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
	@sleep 5
	forge script script/Deploy.s.sol --rpc-url $(ZETA_MAINNET_RPC) --broadcast --verify

# Seed pool (testnet)
.PHONY: seed-pool
seed-pool:
	forge script script/Interact.s.sol:InteractScript --sig "seedPool()" --rpc-url $(ZETA_TESTNET_RPC) --broadcast

# Check contract status
.PHONY: status
status:
	forge script script/Interact.s.sol:InteractScript --sig "checkStatus()" --rpc-url $(ZETA_TESTNET_RPC)

# Test draw function
.PHONY: test-draw
test-draw:
	forge script script/Interact.s.sol:InteractScript --sig "testDraw()" --rpc-url $(ZETA_TESTNET_RPC) --broadcast

# Clean build artifacts
.PHONY: clean
clean:
	forge clean

# Format code
.PHONY: format
format:
	forge fmt

# Install dependencies
.PHONY: install
install:
	forge install

# Update dependencies
.PHONY: update
update:
	forge update
