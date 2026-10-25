import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { EvidenceRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("EvidenceRegistry", function () {
  let registry: EvidenceRegistry;
  let admin: HardhatEthersSigner;
  let officer: HardhatEthersSigner;
  let officerTwo: HardhatEthersSigner;
  let citizen: HardhatEthersSigner;

  const evidenceId = "ev-001-mongo-object-id";
  const fileHash = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
  const ipfsCID = "QmTestCID123456789abcdef";
  const aiScore = 9850n; // 98.50 * 100

  beforeEach(async function () {
    [admin, officer, officerTwo, citizen] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("EvidenceRegistry");
    registry = await factory.deploy(admin.address);
    await registry.waitForDeployment();

    await registry.connect(admin).grantOfficer(officer.address);
    await registry.connect(admin).grantOfficer(officerTwo.address);
  });

  describe("Access Control", function () {
    it("sets deployer as DEFAULT_ADMIN_ROLE", async function () {
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it("allows admin to grant officer role", async function () {
      expect(await registry.hasOfficerRole(officer.address)).to.be.true;
      await expect(registry.connect(admin).grantOfficer(citizen.address))
        .to.emit(registry, "OfficerGranted")
        .withArgs(citizen.address, admin.address, anyValue);
    });

    it("allows admin to revoke officer role", async function () {
      await expect(registry.connect(admin).revokeOfficer(officer.address))
        .to.emit(registry, "OfficerRevoked")
        .withArgs(officer.address, admin.address, anyValue);
      expect(await registry.hasOfficerRole(officer.address)).to.be.false;
    });

    it("rejects non-admin granting officer role", async function () {
      await expect(registry.connect(citizen).grantOfficer(citizen.address)).to.be.reverted;
    });

    it("rejects zero-address officer grant", async function () {
      await expect(registry.connect(admin).grantOfficer(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "InvalidInput"
      );
    });
  });

  describe("addEvidence", function () {
    it("registers evidence and emits EvidenceAdded", async function () {
      await expect(
        registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address)
      )
        .to.emit(registry, "EvidenceAdded")
        .withArgs(evidenceId, fileHash, ipfsCID, aiScore, anyValue, officer.address)
        .and.to.emit(registry, "CustodyEventAdded")
        .withArgs(evidenceId, officer.address, anyValue, "UPLOAD");

      expect(await registry.evidenceExists(evidenceId)).to.be.true;
      expect(await registry.getUploaderEvidenceCount(officer.address)).to.equal(1);
    });

    it("stores uploader as msg.sender even if param matches", async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);
      const record = await registry.getEvidence(evidenceId);
      expect(record.uploaderWallet).to.equal(officer.address);
    });

    it("rejects duplicate evidenceId", async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);

      const otherHash = "b665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae4";
      await expect(
        registry.connect(officer).addEvidence(evidenceId, otherHash, ipfsCID, aiScore, officer.address)
      ).to.be.revertedWithCustomError(registry, "EvidenceAlreadyExists");
    });

    it("rejects duplicate fileHash", async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);

      await expect(
        registry.connect(officer).addEvidence("ev-002", fileHash, ipfsCID, aiScore, officer.address)
      ).to.be.revertedWithCustomError(registry, "FileHashAlreadyExists");
    });

    it("rejects non-officer registration", async function () {
      await expect(
        registry.connect(citizen).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, citizen.address)
      ).to.be.reverted;
    });

    it("rejects registrar registration without REGISTRAR_ROLE", async function () {
      await expect(
        registry.connect(officer).addEvidenceByRegistrar(evidenceId, fileHash, ipfsCID, aiScore, citizen.address)
      ).to.be.reverted;
    });

    it("allows registrar to register evidence for an uploader wallet", async function () {
      await registry.connect(admin).grantRegistrar(admin.address);
      await expect(
        registry.connect(admin).addEvidenceByRegistrar(evidenceId, fileHash, ipfsCID, aiScore, citizen.address)
      )
        .to.emit(registry, "EvidenceAdded")
        .withArgs(evidenceId, fileHash, ipfsCID, aiScore, anyValue, citizen.address);

      const record = await registry.getEvidence(evidenceId);
      expect(record.uploaderWallet).to.equal(citizen.address);
      expect(await registry.getUploaderEvidenceCount(citizen.address)).to.equal(1);
    });

    it("rejects uploaderWallet mismatch", async function () {
      await expect(
        registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, citizen.address)
      ).to.be.revertedWithCustomError(registry, "UploaderMismatch");
    });

    it("rejects empty inputs", async function () {
      await expect(
        registry.connect(officer).addEvidence("", fileHash, ipfsCID, aiScore, officer.address)
      ).to.be.revertedWithCustomError(registry, "InvalidInput");

      await expect(
        registry.connect(officer).addEvidence(evidenceId, "", ipfsCID, aiScore, officer.address)
      ).to.be.revertedWithCustomError(registry, "InvalidInput");

      await expect(
        registry.connect(officer).addEvidence(evidenceId, fileHash, "", aiScore, officer.address)
      ).to.be.revertedWithCustomError(registry, "InvalidInput");
    });

    it("increments uploader count per officer", async function () {
      await registry.connect(officer).addEvidence("ev-a", fileHash, ipfsCID, aiScore, officer.address);
      const hashB = "c665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae5";
      await registry.connect(officer).addEvidence("ev-b", hashB, ipfsCID, aiScore, officer.address);

      expect(await registry.getUploaderEvidenceCount(officer.address)).to.equal(2);
      expect(await registry.getUploaderEvidenceCount(officerTwo.address)).to.equal(0);
    });
  });

  describe("getEvidence & verifyEvidence", function () {
    beforeEach(async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);
    });

    it("returns stored evidence fields", async function () {
      const record = await registry.getEvidence(evidenceId);
      expect(record.storedEvidenceId).to.equal(evidenceId);
      expect(record.fileHash).to.equal(fileHash);
      expect(record.ipfsCID).to.equal(ipfsCID);
      expect(record.aiScore).to.equal(aiScore);
      expect(record.uploaderWallet).to.equal(officer.address);
      expect(record.timestamp).to.be.gt(0);
    });

    it("verifyEvidence returns same integrity data", async function () {
      const verified = await registry.verifyEvidence(evidenceId);
      const stored = await registry.getEvidence(evidenceId);

      expect(verified.fileHash).to.equal(stored.fileHash);
      expect(verified.ipfsCID).to.equal(stored.ipfsCID);
      expect(verified.aiScore).to.equal(stored.aiScore);
      expect(verified.uploaderWallet).to.equal(stored.uploaderWallet);
    });

    it("reverts for missing evidence", async function () {
      await expect(registry.getEvidence("missing-id")).to.be.revertedWithCustomError(registry, "EvidenceNotFound");
      await expect(registry.verifyEvidence("missing-id")).to.be.revertedWithCustomError(registry, "EvidenceNotFound");
    });
  });

  describe("evidenceExists", function () {
    it("returns false before registration", async function () {
      expect(await registry.evidenceExists("ghost-id")).to.be.false;
    });

    it("returns true after registration", async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);
      expect(await registry.evidenceExists(evidenceId)).to.be.true;
    });
  });

  describe("Chain of Custody", function () {
    beforeEach(async function () {
      await registry.connect(officer).addEvidence(evidenceId, fileHash, ipfsCID, aiScore, officer.address);
    });

    it("records UPLOAD event on registration", async function () {
      const history = await registry.getCustodyHistory(evidenceId);
      expect(history.length).to.equal(1);
      expect(history[0].action).to.equal("UPLOAD");
      expect(history[0].actor).to.equal(officer.address);
    });

    it("allows officers to append custody events", async function () {
      await expect(registry.connect(officerTwo).addCustodyEvent(evidenceId, "VIEWED"))
        .to.emit(registry, "CustodyEventAdded")
        .withArgs(evidenceId, officerTwo.address, anyValue, "VIEWED");

      const history = await registry.getCustodyHistory(evidenceId);
      expect(history.length).to.equal(2);
      expect(history[1].action).to.equal("VIEWED");
    });

    it("emits EvidenceVerified on VERIFIED custody action", async function () {
      await expect(registry.connect(officer).addCustodyEvent(evidenceId, "VERIFIED"))
        .to.emit(registry, "EvidenceVerified")
        .withArgs(evidenceId, fileHash, officer.address, anyValue);
    });

    it("rejects custody events for unknown evidence", async function () {
      await expect(registry.connect(officer).addCustodyEvent("unknown", "VIEWED")).to.be.revertedWithCustomError(
        registry,
        "EvidenceNotFound"
      );
    });

    it("rejects empty custody action", async function () {
      await expect(registry.connect(officer).addCustodyEvent(evidenceId, "")).to.be.revertedWithCustomError(
        registry,
        "InvalidInput"
      );
    });

    it("rejects non-officer custody events", async function () {
      await expect(registry.connect(citizen).addCustodyEvent(evidenceId, "VIEWED")).to.be.reverted;
    });
  });

  describe("Constructor", function () {
    it("rejects zero admin address", async function () {
      const factory = await ethers.getContractFactory("EvidenceRegistry");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, "InvalidInput");
    });
  });
});
