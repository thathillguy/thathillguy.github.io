import React from 'react';
import '../Styles/Project.less';
import FlatButton from 'material-ui/FlatButton';


export default class HeaderBar extends React.Component {
    constructor(props) {
        super(props);
    }
    contact(val){
        this.props.contact(val);
    }
    render() {
        return(
            <div className="headerbar">
                <a className="social-icon" href="https://www.linkedin.com/in/robert-hill-470068a8/">
                    <img src="src/Resources/social-1_square-linkedin.svg" />
                </a>
                <a className="social-icon" href="https://github.com/thathillguy">
                    <img src="src/Resources/social-1_square-github.svg" />
                </a>
                <a className="social-icon" href="https://twitter.com/RobertHill352">
                    <img  src="src/Resources/social-1_square-twitter.svg" />
                </a>
                <FlatButton className="contactbutton" label="contact" primary={true} onClick={this.contact.bind(this, 'contact')}/>
                <FlatButton className="contactbutton" label="home" primary={true} onClick={this.contact.bind(this, 'intro')}/>
            </div>
        )
    }
}
