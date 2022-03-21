var ERC20Factory = artifacts.require("ERC20Factory");

contract("Token Factory", async accounts => {
  it('creates tokens', async () => {
    const erc20factory = await ERC20Factory.new();

    await erc20factory.createToken("Basic Token", "BT");
    await erc20factory.createToken("LP BT-BNB", "LPToken");

    const tokens = await erc20factory.getTokens();

    assert(tokens.length === 2);
  });
});