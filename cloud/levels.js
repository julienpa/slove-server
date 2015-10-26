/* global module */
(function() {
'use strict';

// Slove levels ordered from smaller to bigger
var levels = [2, 5, 8, 15, 30, 50, 70, 100, 150, 200];

// Takes a number of Sloves as parameters and returns the matching level
function getLevel(sloveNumber) {
  var levelNumber = 0;
  if (sloveNumber >= levels[0]) {
    while(levels.indexOf(sloveNumber) === -1) {
      sloveNumber--;
    }
    levelNumber = levels.indexOf(sloveNumber) + 1;
  }
  return levelNumber;
}

// Takes 2 Slove numbers and returns TRUE if the level for both is different
function isNewLevel(oldSloveNumber, newSloveNumber) {
  return getLevel(oldSloveNumber) < getLevel(newSloveNumber);
}

// Exporting for use with require()...
module.exports = { getLevel: getLevel, isNewLevel: isNewLevel };

})();
