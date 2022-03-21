var ERC20Factory = artifacts.require("ERC20Factory.sol");
var MockERC20 = artifacts.require("MockERC20.sol");

contract("Token Factory", async accounts => {
  it('creates tokens', async () => {
    const erc20factory = await ERC20Factory.new();

    await erc20factory.createToken("Basic Token", "BT");
    await erc20factory.createToken("LP BT-BNB", "LPToken");

    const tokens = await erc20factory.getTokens();

    assert(tokens.length === 2);

    const lpToken = await MockERC20.at(tokens[1]);

    await lpToken.mint(accounts[1], web3.utils.toWei("1000000"));
    await lpToken.mint(accounts[2], web3.utils.toWei("1000000"));

    depositToken = tokens[1];
    rewardToken = tokens[0];

    assert((await lpToken.balanceOf(accounts[1])).toString() === web3.utils.toWei("1000000"));
    assert((await lpToken.balanceOf(accounts[2])).toString() === web3.utils.toWei("1000000"));
  });
});