'use strict';
const { assert } = require('chai');
const Heap = require('collections/heap');

let heap = new Heap([], null, (a, b) => { return a.val - b.val });

const searchByKey = (key) => {
  return heap.content.findIndex(u => u.key === key);
};


const handleKeyPress = (newWords) => {
    newWords.replace(/[.,!? ]+/g, ' ').split(/\s|\n/).forEach((word) => {
        console.log('word', word);
        if (word.length > 2 && searchByKey(word) === -1){
            heap.push({key: word, val: 1});
        } else if (word.length > 2 && searchByKey(word) !== -1){
            // store previous value
            let value = heap.content[searchByKey(word)].val;
            // delete existing object
            heap.delete({key: word, val: value});
            // recreate object with new value
            heap.push({key: word, val: value + 1});
        }
    });
};

describe('World Cloud', () => {

    it('should add in the proper k:v pairs', () => {
        heap.clear();
        let testString1 = 'This is a test string string';
        handleKeyPress(testString1);

        let pair1Test = heap.content[searchByKey('This')].val === 1;
        let pair2Test = heap.content[searchByKey('test')].val === 1;
        let pair3Test = heap.content[searchByKey('string')].val === 2;
        let pair4Test = searchByKey('is') === -1;
        let pair5Test = searchByKey('a') === -1;
        console.log('test1 end\n', heap.content);
        assert(pair1Test && pair2Test && pair3Test && pair4Test && pair5Test, true);
    });


    it('should handle a string with special characters', () => {
        heap.clear();
        let testString2 = 'This?is.a,test.....!!???string...,...,?!!!?string';
        handleKeyPress(testString2);

        let pair1Test = heap.content[searchByKey('This')].val === 1;
        let pair2Test = heap.content[searchByKey('test')].val === 1;
        let pair3Test = heap.content[searchByKey('string')].val === 2;
        let pair4Test = searchByKey('is') === -1;
        let pair5Test = searchByKey('a') === -1;
        console.log('test2 end\n', heap.content);
        assert(pair1Test && pair2Test && pair3Test && pair4Test && pair5Test, true);
    });

});