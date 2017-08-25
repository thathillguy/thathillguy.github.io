import React from 'react';
import '../Styles/Project.less';
import ContactForm from '../Components/ContactForm';
import WordCloud from '../Components/WordCloud';
import Heap from 'collections/heap';

export default class Contact extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dictionary: {},
            words: []
        };
        this.handleKeyPress = this.handleKeyPress.bind(this);
    }
    handleKeyPress(newWords){
        let dictionary = {};
        let words = [];
        newWords.forEach((word) => {
            word = word.replace(/\,|\.|\?|\!/, '');
            if (!dictionary[word]){
                dictionary[word] = 1;
                words = words.concat(word)
            } else{
                dictionary[word] = dictionary[word] + 1
            }
        });
        words = words.sort((a, b) => {
            return dictionary[b] - dictionary[a]
        });
        this.setState({dictionary: dictionary, words: words});
    }
    render() {
        return(
            <div className="contact">
                <ContactForm handleKeyPress={this.handleKeyPress} />
                <WordCloud words={this.state.words} dictionary={this.state.dictionary}/>
            </div>

        )
    }
}
