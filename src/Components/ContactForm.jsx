import React from 'react';
import '../Styles/Project.less';


export default class ContactForm extends React.Component {
    constructor(props) {
        super(props);
    }
    handleKeyPress(e){
        if (e.keyCode == 32 || e.keyCode == 13 || e.keyCode == 46 || e.keyCode == 33 || e.keyCode == 63 || e.keyCode == 8) {
            this.props.handleKeyPress(e.target.value.split(/\s|\n/));
        }
    }
    render() {
        return(
            <div className="contactform">
                <h1 style={{float:'left', marginLeft:'12.5%', marginRight:'none', width: '75%'}}>
                    Get In Touch
                </h1>
                <input type="text" name="name" placeholder="Full Name" className="oneline"/>
                <input type="text" name="email" placeholder="Email" className="oneline"/>
                <textarea onKeyDown={this.handleKeyPress.bind(this)} type="text" name="Message" placeholder="Message" className="message"/>
                <input className="submitbutton" type="button" value="Submit" />
             </div>
        )
    }
}
