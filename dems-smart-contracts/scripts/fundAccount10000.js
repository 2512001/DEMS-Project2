const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  
  const targetAddress = "0xCd619Abb8228e65BbA8AcA9cbEDFD4a45F8afBCc";
  const amount = ethers.parseEther("9000.0");
  
  console.log("Funding account:", targetAddress);
  console.log("Amount:", ethers.formatEther(amount), "ETH");
  console.log("From:", signer.address);
  
  const tx = await signer.sendTransaction({
    to: targetAddress,
    value: amount
  });
  
  console.log("Transaction hash:", tx.hash);
  console.log("Waiting for confirmation...");
  
  await tx.wait();
  
  console.log("✅ Account funded successfully!");
  
  const balance = await ethers.provider.getBalance(targetAddress);
  console.log("New balance:", ethers.formatEther(balance), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
