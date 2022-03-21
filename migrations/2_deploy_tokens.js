var ERC20Factory = artifacts.require("ERC20Factory.sol");
var MockERC20 = artifacts.require("MockERC20.sol");
var Staker = artifacts.require("Staker.sol");
var Web3 = require('Web3');

module.exports = async function (deployer, network, accounts) {

  await deployer.deploy(ERC20Factory);
  const erc20factory = await ERC20Factory.deployed();
  await erc20factory.createToken("LP BT-BNB", "LPToken"); // Deposit token
  await erc20factory.createToken("Basic Token", "BT");  // Reward token
  const [depositToken, rewardToken] = await erc20factory.getTokens();
  const lpToken = await MockERC20.at(depositToken);
  await lpToken.mint(accounts[1], Web3.utils.toWei("1000000"));
  await lpToken.mint(accounts[2], Web3.utils.toWei("1000000"));

  deployer.deploy(Staker, depositToken, rewardToken);
};