// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Staker is Ownable {
    struct UserInfo {
        uint256 deposited;
        uint256 rewardsAlreadyConsidered;
    }

    mapping(address => UserInfo) public users;

    IERC20 public depositToken; // PancakeSwap LP Token
    IERC20 public rewardToken; // Token

    uint256 public totalStaked;
    uint256 public rewardPeriodEndTimestamp;
    uint256 public rewardPerSecond; // multiplied by 1e7, to make up for division by 24*60*60
    uint256 public lastRewardTimestamp;
    uint256 public accumulatedRewardPerShare;

    event AddRewards(uint256 amount, uint256 lengthInDays);
    event ClaimReward(address indexed user, uint256 amount);
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Skim(uint256 amount);

    constructor(address _depositToken, address _rewardToken) {
        depositToken = IERC20(_depositToken);
        rewardToken = IERC20(_rewardToken);
    }

    // Owner should have approved ERC20 before.
    function addRewards(uint256 _rewardsAmount, uint256 _lengthInDays) external onlyOwner {
        require(block.timestamp > rewardPeriodEndTimestamp, "Staker: can't add rewards before period finished");
        updateRewards();
        rewardPeriodEndTimestamp = block.timestamp + _lengthInDays * (24 * 60 * 60);
        rewardPerSecond = (_rewardsAmount * 1e7) / _lengthInDays / (24 * 60 * 60);
        require(rewardToken.transferFrom(msg.sender, address(this), _rewardsAmount), "Staker: transfer failed");
        emit AddRewards(_rewardsAmount, _lengthInDays);
    }

    // Is called before each user action (stake, unstake, claim).
    function updateRewards() public {
        // If no staking period active, or already updated rewards after staking ended, or nobody staked anything - nothing to do
        if (block.timestamp <= lastRewardTimestamp) {
            return;
        }
        if ((totalStaked == 0) || lastRewardTimestamp > rewardPeriodEndTimestamp) {
            lastRewardTimestamp = block.timestamp;
            return;
        }

        // If staking period ended, calculate time delta based on the time the staking ended (and not after)
        uint256 endingTime;
        if (block.timestamp > rewardPeriodEndTimestamp) {
            endingTime = rewardPeriodEndTimestamp;
        } else {
            endingTime = block.timestamp;
        }
        uint256 secondsSinceLastRewardUpdate = endingTime - lastRewardTimestamp;
        uint256 totalNewReward = secondsSinceLastRewardUpdate * rewardPerSecond;

        // The next line will calculate the reward for each staked token in the pool.
        //  So when a specific user will claim his rewards,
        //  we will basically multiply this var by the amount the user staked.
        accumulatedRewardPerShare = accumulatedRewardPerShare + ((totalNewReward * 1e12) / totalStaked);
        lastRewardTimestamp = block.timestamp;
        if (block.timestamp > rewardPeriodEndTimestamp) {
            rewardPerSecond = 0;
        }
    }

    // Will deposit specified amount and also send rewards.
    // User should have approved ERC20 before.
    function deposit(uint256 _amount) external {
        UserInfo storage user = users[msg.sender];
        updateRewards();
        if (user.deposited > 0) {
            sendRewardForPreviousDeposits();
        }

        // Update user info
        user.deposited = user.deposited + _amount;
        totalStaked = totalStaked + _amount;
        user.rewardsAlreadyConsidered = (user.deposited * accumulatedRewardPerShare) / 1e12 / 1e7;

        require(depositToken.transferFrom(msg.sender, address(this), _amount), "Staker: transferFrom failed");
        emit Deposit(msg.sender, _amount);
    }

    // Will withdraw the specified amount and also send rewards.
    function withdraw(uint256 _amount) external {
        UserInfo storage user = users[msg.sender];
        require(user.deposited >= _amount, "Staker: balance not enough");
        updateRewards();
        sendRewardForPreviousDeposits();

        // Update user info
        user.deposited = user.deposited - _amount;
        totalStaked = totalStaked - _amount;
        user.rewardsAlreadyConsidered = (user.deposited * accumulatedRewardPerShare) / 1e12 / 1e7;

        require(depositToken.transfer(msg.sender, _amount), "Staker: deposit withdrawal failed");
        emit Withdraw(msg.sender, _amount);
    }

    function sendRewardForPreviousDeposits() internal {
        UserInfo storage user = users[msg.sender];
        uint256 pending = (user.deposited * accumulatedRewardPerShare) / 1e12 / 1e7 - user.rewardsAlreadyConsidered;
        require(rewardToken.transfer(msg.sender, pending), "Staker: reward transfer failed");
        emit ClaimReward(msg.sender, pending);
    }

    // Will just send rewards.
    function claim() external {
        UserInfo storage user = users[msg.sender];
        if (user.deposited == 0) return;

        updateRewards();
        uint256 pending = (user.deposited * (accumulatedRewardPerShare)) / (1e12) / (1e7) - (user.rewardsAlreadyConsidered);
        require(rewardToken.transfer(msg.sender, pending), "Staker: transfer failed");
        emit ClaimReward(msg.sender, pending);
        user.rewardsAlreadyConsidered = (user.deposited * (accumulatedRewardPerShare)) / (1e12) / (1e7);
    }

    // Return the user's pending rewards.
    function pendingRewards(address _user) public view returns (uint256) {
        UserInfo storage user = users[_user];
        uint256 accumulated = accumulatedRewardPerShare;
        if (block.timestamp > lastRewardTimestamp && lastRewardTimestamp <= rewardPeriodEndTimestamp && totalStaked != 0) {
            uint256 endingTime;
            if (block.timestamp > rewardPeriodEndTimestamp) {
                endingTime = rewardPeriodEndTimestamp;
            } else {
                endingTime = block.timestamp;
            }
            uint256 secondsSinceLastRewardUpdate = endingTime - (lastRewardTimestamp);
            uint256 totalNewReward = secondsSinceLastRewardUpdate * (rewardPerSecond);
            accumulated = accumulated + ((totalNewReward * (1e12)) / (totalStaked));
        }
        return (user.deposited * (accumulated)) / (1e12) / (1e7) - (user.rewardsAlreadyConsidered);
    }

    // Will collect depositTokens (LP tokens) that were sent to the contract outside of the staking mechanism.
    function skim() external onlyOwner {
        uint256 depositTokenBalance = depositToken.balanceOf(address(this));
        if (depositTokenBalance > totalStaked) {
            uint256 amount = depositTokenBalance - (totalStaked);
            require(depositToken.transfer(msg.sender, amount), "Staker: transfer failed");
            emit Skim(amount);
        }
    }
}
