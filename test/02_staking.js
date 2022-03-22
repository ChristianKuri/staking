const Staker = artifacts.require("Staker");
const ERC20Factory = artifacts.require("ERC20Factory");
const MockERC20 = artifacts.require("MockERC20");
const timeMachine = require('ganache-time-traveler');

contract('staker', async accounts => {
  let stakerContract;
  let depositToken;
  let rewardToken;

  let defaultOptions = { from: accounts[0] };
  let BN = web3.utils.BN;
  let secondsInDayBN = new BN(24).mul(new BN(60)).mul(new BN(60));
  let rpsMultiplierBN = new BN(10 ** 7);

  async function getTime() {
    return (await web3.eth.getBlock((await web3.eth.getBlockNumber())))["timestamp"];
  }

  beforeEach(async () => {
    const factoryContract = await ERC20Factory.new()

    await factoryContract.createToken("LP BT-BNB", "LPToken"); // Deposit token
    await factoryContract.createToken("Basic Token", "BT");  // Reward token
    const [depositTokenAddr, rewardTokenAddr] = await factoryContract.getTokens();
    depositToken = await MockERC20.at(depositTokenAddr);
    rewardToken = await MockERC20.at(rewardTokenAddr);
    await depositToken.mint(accounts[1], web3.utils.toWei("1000000"));
    await depositToken.mint(accounts[2], web3.utils.toWei("1000000"));

    stakerContract = await Staker.new(depositTokenAddr, rewardTokenAddr);


    let snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot['result'];
  });

  afterEach(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  it("should calculate the parameters correctly", async () => {
    let rewardAmount = web3.utils.toWei("300");
    let days = 30;

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

  it("allows to deposit", async () => {
    const depositAmount = web3.utils.toWei("10");
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] });
    await stakerContract.deposit(depositAmount, { from: accounts[1] });

    const userDetails = await stakerContract.users(accounts[1]);

    assert.equal(userDetails[0].toString(), depositAmount, "Wrong deposit amount");
  });

  it("allows to withdraw", async () => {
    const depositAmount = web3.utils.toWei("10");
    const withdrawAmount = web3.utils.toWei("5");

    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] });
    await stakerContract.deposit(depositAmount, { from: accounts[1] });
    await stakerContract.withdraw(withdrawAmount, { from: accounts[1] });

    const userDetails = await stakerContract.users(accounts[1]);

    assert.equal(userDetails[0].toString(), web3.utils.toWei("5"), "Wrong deposit amount");
  });

  it.only('allows to add rewards', async () => {
    const rewardAmount = web3.utils.toWei("300");
    const days = 30;

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount, defaultOptions);
    await stakerContract.addRewards(rewardAmount, days, defaultOptions);

    const contractRps = await stakerContract.rewardPerSecond.call(defaultOptions);
    const expectedReward = await new BN(rewardAmount).mul(rpsMultiplierBN).div(new BN(days)).div(secondsInDayBN);

    assert.equal(contractRps.toString(), expectedReward.toString(), "Wrong rewards per second");
  })

})