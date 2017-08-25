import React from 'react';
import '../Styles/Project.less';
import ContactForm from '../Components/ContactForm';
import WordCloud from '../Components/WordCloud';
import Heap from 'collections/heap';

export default class Contact extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dictionary: [],
            words: []
        };
        this.handleKeyPress = this.handleKeyPress.bind(this);
    }


    handleKeyPress(newWords) {

        let dict = new Heap([], null, (a, b) => { return a.val - b.val });

        const searchByKey = (key) => {
            return dict.content.findIndex(u => u.key === key);
        };

        newWords.replace(/[.,!? ]+/g, ' ').split(/\s|\n/).forEach((word) => {
            console.log('word', word);
            if (word.length > 2 && searchByKey(word) === -1){
                dict.push({key: word, val: 1});
            } else if (word.length > 2 && searchByKey(word) !== -1){
                // store previous value
                let value = dict.content[searchByKey(word)].val;
                // delete existing object
                dict.delete({key: word, val: value});
                // recreate object with new value
                dict.push({key: word, val: value + 1});
            }
        });
        this.setState({dictionary: dict.content});
    }

    render() {
        return(
            <div className="contact">
                <ContactForm handleKeyPress={this.handleKeyPress.bind(this)} />
                <WordCloud dictionary={this.state.dictionary}/>
            </div>

        )
    }
}
