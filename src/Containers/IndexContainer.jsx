import React from 'react';
import '../Styles/Project.less';

import HeaderBar from '../Components/HeaderBar';
import Intro from '../Sections/Intro';
import About from '../Sections/About';
import Contact from '../Sections/Contact';
import ActiveBackground from '../Components/ActiveBackgound'
import Modal from '../Components/Modal';

export default class IndexContainer extends React.Component {
    constructor(props){
        super(props);
        this.state = {
            active: 'intro'
        };
        this.contact = this.contact.bind(this);
    }
    componentDidMount() {
        console.log('did')
    }
    componentWillMount() {
        console.log('will')
    }
    contact(value) {
        this.setState({active: value});
    }
    render() {
        console.log(this.state.active);
        return(
            <div className="index">
                <HeaderBar contact={this.contact}/>
                {this.state.active === 'intro' ? <Intro /> : <Contact />}
            </div>
        )
    }
}
