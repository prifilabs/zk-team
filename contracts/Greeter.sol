//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

// import "hardhat/console.sol";

contract Greeter {
    string private greeting;

    constructor(string memory _greeting) {
        // console.log("Deploying a Greeter with greeting:", _greeting);
        greeting = _greeting;
    }

    function greet() public view returns (string memory) {
        // console.log("'%s' from '%s'", greeting, msg.sender);
        return greeting;
    }

    function setGreeting(string memory _greeting) public payable {
        // console.log("Changing greeting from '%s' to '%s'", greeting, _greeting);
        greeting = _greeting;
    }
}
