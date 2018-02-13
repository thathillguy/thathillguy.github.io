import React from 'react';
import '../Styles/Project.less';


export default class DisplayText extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            text: 'student',
            status: 'decreasing',
            index: 0
        };
        this.text_array = ['Problem Solver', 'developer', 'data enthusiast'];
    }
    updateText(){
        this.state.text.length > 0 ?
            (this.state.status == 'decreasing' ?
                ( this.state.text == this.text_array[this.state.index] ?
                    window.displaytt2 = setTimeout(this.decrementText.bind(this), 3000) : this.decrementText())
                : this.incrementText()) :
            (this.state.status == 'decreasing' ? this.changeText() : this.incrementText());

    }
    decrementText(){
        this.setState({text: this.state.text.substring(0, this.state.text.length-1)})
    }
    incrementText(){
        if (this.state.text == this.text_array[this.state.index]) {
            this.setState({status: 'decreasing'});
        } else {
            this.setState({text: this.text_array[this.state.index].substring(0, this.state.text.length+1)})
        }
    }
    changeText(){
        let i;
        (this.state.index == this.text_array.length - 1) ? (i = 0) : (i = this.state.index + 1);
        this.setState({index: i, status: 'increasing'})
    }
    render() {
        window.displaytt = setTimeout(this.updateText.bind(this), 50);
        return(
            <h2> {this.state.text}</h2>
        )
    }
    componentWillUnmount(){
        if (window.displaytt){
            window.clearInterval(window.displaytt);
        }
        if (window.displaytt2){
            window.clearInterval(window.displaytt2)
        }
    }
}
