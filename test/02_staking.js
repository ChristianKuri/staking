const Staker = artifacts.require("Staker");
const ERC20Factory = artifacts.require("ERC20Factory");
const MockERC20 = artifacts.require("MockERC20");
const timeMachine = require('ganache-time-traveler');

contract('staker', async accounts => {
  let stakerContract;

  beforeEach(async () => {
    const factoryContract = await ERC20Factory.new()

    await factoryContract.createToken("LP BT-BNB", "LPToken"); // Deposit token
    await factoryContract.createToken("Basic Token", "BT");  // Reward token
    const [depositToken, rewardToken] = await factoryContract.getTokens();

    stakerContract = await Staker.new(depositToken, rewardToken);


    let snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot['result'];
  });

  afterEach(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  async function getTime() {
    return (await web3.eth.getBlock((await web3.eth.getBlockNumber())))["timestamp"];
  }

  let BN = web3.utils.BN;
  let secondsInDayBN = new BN(24).mul(new BN(60)).mul(new BN(60));
  let rpsMultiplierBN = new BN(10 ** 7);

  it.only("should calculate the parameters correctly", async () => {
    const rewardTokenAddr = await stakerContract.rewardToken();

    let rewardAmount = web3.utils.toWei("300");
    let days = 30;

    const rewardToken = await MockERC20.at(rewardTokenAddr);
    await rewardToken.approve(stakerContract.address, rewardAmount);

    // Add staking rewards
    await stakerContract.addRewards(rewardAmount, days);
    let startingTime = await getTime();

    // Verify rewards-per-second calculation is correct
    let contractRps = await stakerContract.rewardPerSecond();
    let expectedRps = await (new BN(rewardAmount)).mul(rpsMultiplierBN).div(new BN(days)).div(secondsInDayBN);
    assert.equal(contractRps.toString(), expectedRps.toString(), "Wrong rewards per second");

    // Verify staking campaign end time calculation is correct
    let contractEndTime = await stakerContract.rewardPeriodEndTimestamp();
    let expectedEndTime = await (new BN(startingTime).add(new BN(days).mul(secondsInDayBN)));
    assert.equal(contractEndTime.toString(), expectedEndTime.toString(), "Wrong contract end time");
  });
})