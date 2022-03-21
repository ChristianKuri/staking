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
}
