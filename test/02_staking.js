const Staker = artifacts.require('Staker')
const ERC20Factory = artifacts.require('ERC20Factory')
const MockERC20 = artifacts.require('MockERC20')
const timeMachine = require('ganache-time-traveler')

contract('staker', async (accounts) => {
  let stakerContract
  let depositToken
  let rewardToken

  const defaultOptions = { from: accounts[0] }
  const BN = web3.utils.BN
  const secondsInDayBN = new BN(24).mul(new BN(60)).mul(new BN(60))
  const rpsMultiplierBN = new BN(10 ** 7)

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
  })

  it('should calculate the parameters correctly', async () => {
    const rewardAmount = web3.utils.toWei('300')
    const days = 30

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount)
    await stakerContract.addRewards(rewardAmount, days)
    const startingTime = await getTime()

    // Verify rewards-per-second calculation is correct
    const contractRps = await stakerContract.rewardPerSecond()
    const expectedRps = await new BN(rewardAmount).mul(rpsMultiplierBN).div(new BN(days)).div(secondsInDayBN)
    assert.equal(contractRps.toString(), expectedRps.toString(), 'Wrong rewards per second')

    // Verify staking campaign end time calculation is correct
    const contractEndTime = await stakerContract.rewardPeriodEndTimestamp()
    const expectedEndTime = await new BN(startingTime).add(new BN(days).mul(secondsInDayBN))
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
    const initialReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    assert.equal(initialReward.toString(), 0, 'User has rewards pending straight after staking')

    // Advance time by 2 hours, make sure reward calculation is correct in pendingRewards() view function
    const twoHours = 60 * 60 * 2
    await timeMachine.advanceTimeAndBlock(twoHours)

    // Verify user reward balance is correct
    const contractPendingReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    const expectedPendingReward = contractRps.mul(new BN(twoHours)).div(rpsMultiplierBN)
    assertEqualWithMargin(
      contractPendingReward,
      expectedPendingReward,
      contractRps.div(rpsMultiplierBN),
      'Wrong pending rewards (view) calculation',
    )

    // Claim rewards
    await stakerContract.claim({ from: accounts[1] })
    const userNewRewardBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })
    assertEqualWithMargin(
      userNewRewardBalance,
      expectedPendingReward,
      contractRps.div(rpsMultiplierBN),
      'Wrong amount of rewards sent to user after claim()',
    )
  })

  it('allows to collect LP Tokens that were sent to the contract outside of the staking mechanism', async () => {
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

  it('should calculate and distribute rewards correctly to one person across multiple campaigns and multiple actions', async () => {
    const rewardAmount = web3.utils.toWei('300')
    const days = 30

    // Store initial LP and reward balance
    let prevUserRewardTokenBalance = await rewardToken.balanceOf.call(accounts[1], { from: accounts[1] })
    let prevUserDepositTokenBalance = await depositToken.balanceOf.call(accounts[1], { from: accounts[1] })

    // Add staking rewards
    await rewardToken.approve(stakerContract.address, rewardAmount, defaultOptions)
    await stakerContract.addRewards(rewardAmount, days, defaultOptions)
    let prevContractRewardTokenBalance = await rewardToken.balanceOf(stakerContract.address, { from: accounts[1] })
    const contractRps = await stakerContract.rewardPerSecond.call(defaultOptions)

    // User deposit funds
    const depositAmount = web3.utils.toWei('10')
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] })
    await stakerContract.deposit(depositAmount, { from: accounts[1] })
    const initialReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    assert.equal(initialReward.toString(), 0, 'User has rewards pending straight after staking')

    // Advance time by 10 days
    let secsToAdvance = 60 * 60 * 24 * 10
    await timeMachine.advanceTimeAndBlock(secsToAdvance)

    // Make sure reward calculation is correct in pendingRewards() view function
    let contractPendingReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    let expectedPendingReward = new BN(contractRps).mul(new BN(secsToAdvance)).div(rpsMultiplierBN)
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

    // Withdraw funds
    await stakerContract.withdraw(depositAmount, { from: accounts[1] })
    prevUserRewardTokenBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })

    // Check user deposit balance
    const userNewDepositBalance = await depositToken.balanceOf(accounts[1], { from: accounts[1] })
    assert.equal(
      userNewDepositBalance.toString(),
      prevUserDepositTokenBalance.toString(),
      'Wrong user deposit token balance after withdraw',
    )
    prevUserDepositTokenBalance = userNewDepositBalance

    // Advance 15 days
    secsToAdvance = 60 * 60 * 24 * 15
    await timeMachine.advanceTimeAndBlock(secsToAdvance)

    // Try to claim rewards
    await stakerContract.claim({ from: accounts[1] })
    userNewRewardBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })
    assert.equal(
      userNewRewardBalance.toString(),
      prevUserRewardTokenBalance.toString(),
      'User received rewards even tho he withdrew all stake previously',
    )

    // User deposit funds
    await depositToken.approve(stakerContract.address, depositAmount, { from: accounts[1] })
    await stakerContract.deposit(depositAmount, { from: accounts[1] })

    // Advance time by 7 days
    secsToAdvance = 60 * 60 * 24 * 7
    await timeMachine.advanceTimeAndBlock(secsToAdvance)

    // Add new rewards
    const newRewardAmount = web3.utils.toWei('10')
    const newDays = 6
    await rewardToken.approve(stakerContract.address, newRewardAmount, defaultOptions)
    await stakerContract.addRewards(newRewardAmount, newDays, defaultOptions)

    // Advance time by 3 days
    const newSecsToAdvance = 60 * 60 * 24 * 3
    await timeMachine.advanceTimeAndBlock(newSecsToAdvance)

    // Get contract rewards per second
    const newContractRps = await stakerContract.rewardPerSecond.call(defaultOptions)

    // Make sure reward calculation is correct in pendingRewards() view function
    const expectedTotalReward = contractRps
      .mul(new BN(60 * 60 * 24 * 5))
      .div(rpsMultiplierBN)
      .add(newContractRps.mul(new BN(newSecsToAdvance)).div(rpsMultiplierBN))
    contractPendingReward = await stakerContract.pendingRewards.call(accounts[1], { from: accounts[1] })
    assertEqualWithMargin(
      contractPendingReward,
      expectedTotalReward,
      contractRps.add(newContractRps).div(rpsMultiplierBN),
      'Wrong pending rewards (view) calculation after adding new campaign',
    )

    // Store initial LP and reward balance
    prevUserRewardTokenBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })
    prevUserDepositTokenBalance = await depositToken.balanceOf(accounts[1], { from: accounts[1] })

    // Withdraw LP and rewards
    const withdrawAmount = new BN(depositAmount).div(new BN(2))
    await stakerContract.withdraw(withdrawAmount.toString(), { from: accounts[1] })

    // Store final LP and reward balance
    const newUserRewardTokenBalance = await rewardToken.balanceOf(accounts[1], { from: accounts[1] })
    const newUserDepositTokenBalance = await depositToken.balanceOf(accounts[1], { from: accounts[1] })

    // Verify that LP and reward balances are correct
    assertEqualWithMargin(
      newUserDepositTokenBalance,
      prevUserDepositTokenBalance.add(withdrawAmount),
      contractRps.add(newContractRps).div(rpsMultiplierBN),
      'After withdraw(), wrong deposit token balance',
    )
    assertEqualWithMargin(
      newUserRewardTokenBalance,
      prevUserRewardTokenBalance.add(expectedTotalReward),
      contractRps.add(newContractRps).div(rpsMultiplierBN),
      'After withdraw(), wrong reward token balance',
    )
  })
})
