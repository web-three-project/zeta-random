"""
Generate a batch of lottery codes and their keccak hashes for ManageLotteryCode.

Returns (codes, code_hashes_hex) where code_hashes_hex is ready for
`batchAddCode(bytes32[] codeHashes)` in Solidity.
"""

import string
import secrets
from typing import List, Tuple

# Keccak256 helper compatible with Solidity's keccak256 used in `contract/src/ManageLotteryCode.sol`
try:
    from eth_utils import keccak as _keccak  # pip install eth-utils

    def keccak256(data: bytes) -> bytes:
        return _keccak(data)
except ImportError:  # fallback to web3 if available
    try:
        from web3 import Web3  # pip install web3

        def keccak256(data: bytes) -> bytes:
            return Web3.keccak(data)
    except ImportError as e:  # final fallback: raise helpful error when hashing is requested
        def keccak256(_: bytes) -> bytes:  # type: ignore
            raise ImportError("eth-utils or web3 is required for keccak256. Install with: pip install eth-utils or web3")


ALPHABET = string.ascii_uppercase + string.digits  # 26 letters + 10 digits


def generate_unique_codes(
    n: int = 200,
    length: int = 8,
    alphabet: str = ALPHABET,
) -> List[str]:
    """Generate n unique random codes with given length from the provided alphabet.

    - Uses `secrets.choice` for cryptographically stronger randomness.
    - Ensures uniqueness by sampling until the set size reaches n.
    """
    if length <= 0:
        raise ValueError("length must be > 0")
    if n <= 0:
        raise ValueError("n must be > 0")
    if not alphabet:
        raise ValueError("alphabet must not be empty")

    codes = set()
    # Upper bound to avoid infinite loop in pathological cases
    max_attempts = n * 20
    attempts = 0
    while len(codes) < n:
        code = "".join(secrets.choice(alphabet) for _ in range(length))
        codes.add(code)
        attempts += 1
        if attempts > max_attempts:
            raise RuntimeError("Failed to generate enough unique codes; consider increasing length or alphabet size")
    return list(codes)


def codes_to_keccak_hashes(codes: List[str]) -> List[str]:
    """Compute keccak256 hashes for each code, returning 0x-prefixed hex strings (bytes32) for Solidity.

    Matches Solidity's `keccak256(bytes(code))` used for `batchAddCode(bytes32[])` in
    `contract/src/ManageLotteryCode.sol`.
    """
    hashes: List[str] = []
    for code in codes:
        digest = keccak256(code.encode("utf-8"))  # bytes
        # Represent as 0x-prefixed hex string compatible with bytes32
        hashes.append("0x" + digest.hex())
    return hashes


def generate_lottery_codes_batch(n: int = 200, length: int = 8) -> Tuple[List[str], List[str]]:
    """Generate a batch of lottery codes and their keccak hashes for ManageLotteryCode.

    Returns (codes, code_hashes_hex) where code_hashes_hex is ready for
    `batchAddCode(bytes32[] codeHashes)` in Solidity.
    """
    codes = generate_unique_codes(n=n, length=length)
    hashes = codes_to_keccak_hashes(codes)
    return codes, hashes


if __name__ == "__main__":
    # Preview: generate and print a small sample so you can verify format.
    codes, hashes = generate_lottery_codes_batch(n=200, length=8)
    print("Sample codes (first 10):")
    for c in codes[:10]:
        print(c)

    print("\nSample hashes (first 10):")
    for h in hashes[:10]:
        print(h)

    print("\nTotal generated:", len(codes), "codes /", len(hashes), "hashes")