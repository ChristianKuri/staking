const Staker = artifacts.require('Staker')
const ERC20Factory = artifacts.require('ERC20Factory')
const MockERC20 = artifacts.require('MockERC20')
const timeMachine = require('ganache-time-traveler')

contract('staker', async (accounts) => {
  let stakerContract
  let depositToken
  let rewardToken
  let snapShotId

  let defaultOptions = { from: accounts[0] }
  let BN = web3.utils.BN
  let secondsInDayBN = new BN(24).mul(new BN(60)).mul(new BN(60))
  let rpsMultiplierBN = new BN(10 ** 7)

  async function getTime() {
    return (await web3.eth.getBlock(await web3.eth.getBlockNumber()))['timestamp']
  }

  function assertEqualWithMargin(_num1, _num2, _margin, _message) {
    if (
      BN.max(_num1, _num2)
        .sub(BN.min(_num1, _num2))
        .lte(_margin.mul(new BN(3)))
    )
      return

    assert.equal(_num1.toString(), _num2.toString(), _message)
  }

  beforeEach(async () => {
    // Deploy the factory contract
    const factoryContract = await ERC20Factory.new()

    // Deploy the reward and LP token
    await factoryContract.createToken('LP BT-BNB', 'LPToken') // Deposit token
    await factoryContract.createToken('Basic Token', 'BT') // Reward token
    const [depositTokenAddr, rewardTokenAddr] = await factoryContract.getTokens()

    // Mock the reward and LP token
    depositToken = await MockERC20.at(depositTokenAddr)
    rewardToken = await MockERC20.at(rewardTokenAddr)

    // Give LP token some initial balance to be staked
    await depositToken.mint(accounts[1], web3.utils.toWei('1000000'))
    await depositToken.mint(accounts[2], web3.utils.toWei('1000000'))

    // Deploy the staker contract
    stakerContract = await Staker.new(depositTokenAddr, rewardTokenAddr)

    // Make a snapshot of the blockchain
    let snapshot = await timeMachine.takeSnapshot()
    snapshotId = snapshot['result']
  })

  afterEach(async () => {
    // Revert the blockchain to the previous snapshot
    await timeMachine.revertToSnapshot(snapshotId)
  })

  it('should calculate the parameters correctly', async () => {
    let rewardAmount = web3.utils.toWei('300')
    let days = 30

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount)
    await stakerContract.addRewards(rewardAmount, days)
    let startingTime = await getTime()

    // Verify rewards-per-second calculation is correct
    let contractRps = await stakerContract.rewardPerSecond()
    let expectedRps = await new BN(rewardAmount).mul(rpsMultiplierBN).div(new BN(days)).div(secondsInDayBN)
    assert.equal(contractRps.toString(), expectedRps.toString(), 'Wrong rewards per second')

    // Verify staking campaign end time calculation is correct
    let contractEndTime = await stakerContract.rewardPeriodEndTimestamp()
    let expectedEndTime = await new BN(startingTime).add(new BN(days).mul(secondsInDayBN))
    assert.equal(contractEndTime.toString(), expectedEndTime.toString(), 'Wrong contract end time')
  })

  it('allows to deposit', async () => {
    // Deposit LP tokens into the staker contract
    const depositAmount = web3.utils.toWei('10')
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] })
    await stakerContract.deposit(depositAmount, { from: accounts[1] })

    // Verify the staker contract balance is correct
    const userDetails = await stakerContract.users(accounts[1])
    assert.equal(userDetails[0].toString(), depositAmount, 'Wrong deposit amount')
  })

  it('allows to withdraw', async () => {
    // Deposit LP tokens into the staker contract
    const depositAmount = web3.utils.toWei('10')
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] })
    await stakerContract.deposit(depositAmount, { from: accounts[1] })

    // Withdraw LP tokens from the staker contract
    const withdrawAmount = web3.utils.toWei('5')
    await stakerContract.withdraw(withdrawAmount, { from: accounts[1] })

    // Verify the staker contract balance is correct
    const userDetails = await stakerContract.users(accounts[1])
    assert.equal(userDetails[0].toString(), web3.utils.toWei('5'), 'Wrong deposit amount')
  })

  it('allows to add rewards', async () => {
    const rewardAmount = web3.utils.toWei('300')
    const days = 30

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount, defaultOptions)
    await stakerContract.addRewards(rewardAmount, days, defaultOptions)

    // Verify the rewards per second are correct
    const contractRps = await stakerContract.rewardPerSecond.call(defaultOptions)
    const expectedReward = await new BN(rewardAmount).mul(rpsMultiplierBN).div(new BN(days)).div(secondsInDayBN)
    assert.equal(contractRps.toString(), expectedReward.toString(), 'Wrong rewards per second')
  })

  it('allows to claim rewards', async () => {
    const rewardAmount = web3.utils.toWei('300')
    const days = 30

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount, defaultOptions)
    await stakerContract.addRewards(rewardAmount, days, defaultOptions)

    // User deposit funds
    const depositAmount = web3.utils.toWei('10')
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] })
    await stakerContract.deposit(depositAmount, { from: accounts[1] })
    const contractRps = await stakerContract.rewardPerSecond.call(defaultOptions)

    // Verify user reward balance is 0
    let initialReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    assert.equal(initialReward.toString(), 0, 'User has rewards pending straight after staking')

    // Advance time by 1 hour, make sure reward calculation is correct in pendingRewards() view function
    let twoHours = 60 * 60 * 2
    await timeMachine.advanceTimeAndBlock(twoHours)

    // Verify user reward balance is correct
    let contractPendingReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    let expectedPendingReward = contractRps.mul(new BN(twoHours)).div(rpsMultiplierBN)
    console.log(contractPendingReward.toString(), expectedPendingReward.toString())
    assertEqualWithMargin(
      contractPendingReward,
      expectedPendingReward,
      contractRps.div(rpsMultiplierBN),
      'Wrong pending rewards (view) calculation',
    )

    // Claim rewards
    await stakerContract.claim({ from: accounts[1] })
    let userNewRewardBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })
    assertEqualWithMargin(
      userNewRewardBalance,
      expectedPendingReward,
      contractRps.div(rpsMultiplierBN),
      'Wrong amount of rewards sent to user after claim()',
    )
  })

  it.only('allows to collect LP Tokens that were sent to the contract outside of the staking mechanism', async () => {
    // User transfer LP Tokens to the contract
    const depositAmount = web3.utils.toWei('10')
    await depositToken.transfer(stakerContract.address, depositAmount, { from: accounts[1] })

    // Verify user LP balance is 0
    const userDetails = await stakerContract.users(accounts[1])
    assert.equal(userDetails[0].toString(), 0, 'Wrong deposit amount')

    // Collect the LP Tokens
    const initialLPBalance = await depositToken.balanceOf(accounts[0])
    await stakerContract.skim()
    const finalLPBalance = await depositToken.balanceOf(accounts[0])

    assert.equal(finalLPBalance.toString(), new BN(initialLPBalance).add(new BN(depositAmount)).toString(), 'Wrong LP balance after skim')
  })

})