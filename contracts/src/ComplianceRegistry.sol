// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ComplianceRegistry
/// @notice On-chain KYC/eligibility registry for the RWAkins RWA vault. Tokenized
///         treasuries (USDY) are regulated securities — holders must pass KYC and
///         clear jurisdiction/accreditation checks. This registry is the on-chain
///         source of truth the vault gates deposits on.
///
///         Verification is AI-ASSISTED and AUDITABLE: the off-chain compliance
///         screener (LLM + real restricted-jurisdiction reference data) reaches a
///         verdict, and the agent compliance officer key writes it here. Every
///         decision is an on-chain event with the jurisdiction, accreditation,
///         risk score, and an expiry (KYC must be periodically refreshed).
contract ComplianceRegistry {
    struct Record {
        bool verified;
        bool accredited;
        uint8 riskScore; // 0 (clean) – 100 (blocked), from the screener
        uint64 verifiedAt;
        uint64 expiry; // 0 = never expires
        bytes2 jurisdiction; // ISO-3166 alpha-2, e.g. "US","SG"
    }

    address public owner; // agent compliance-officer key
    mapping(address => Record) public records;

    event ComplianceSet(
        address indexed user,
        bool verified,
        bool accredited,
        uint8 riskScore,
        bytes2 jurisdiction,
        uint64 expiry
    );
    event ComplianceRevoked(address indexed user, string reason);
    event OfficerTransferred(address indexed from, address indexed to);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OFFICER");
        _;
    }

    function transferOfficer(address to) external onlyOwner {
        require(to != address(0), "ZERO");
        emit OfficerTransferred(owner, to);
        owner = to;
    }

    /// @notice Write a screening verdict on-chain (agent compliance officer only).
    function setCompliance(
        address user,
        bool verified,
        bool accredited,
        uint8 riskScore,
        bytes2 jurisdiction,
        uint64 expiry
    ) external onlyOwner {
        require(user != address(0), "ZERO");
        records[user] = Record({
            verified: verified,
            accredited: accredited,
            riskScore: riskScore,
            verifiedAt: uint64(block.timestamp),
            expiry: expiry,
            jurisdiction: jurisdiction
        });
        emit ComplianceSet(user, verified, accredited, riskScore, jurisdiction, expiry);
    }

    function revoke(address user, string calldata reason) external onlyOwner {
        delete records[user];
        emit ComplianceRevoked(user, reason);
    }

    /// @notice True when `user` is verified and not expired — the vault's gate.
    function isCompliant(address user) public view returns (bool) {
        Record memory r = records[user];
        if (!r.verified) return false;
        if (r.expiry != 0 && block.timestamp > r.expiry) return false;
        return true;
    }

    /// @notice Full record for the frontend status badge.
    function statusOf(address user)
        external
        view
        returns (bool verified, bool accredited, uint8 riskScore, bytes2 jurisdiction, uint64 expiry)
    {
        Record memory r = records[user];
        return (isCompliant(user), r.accredited, r.riskScore, r.jurisdiction, r.expiry);
    }
}
