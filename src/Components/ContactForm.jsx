import React from 'react';
import '../Styles/Project.less';


export default class ContactForm extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="contactform">
                <input type="text" name="name" placeholder="Full Name" className="oneline"/>
                <input type="text" name="email" placeholder="Email" className="oneline"/>
                <textarea type="text" name="message" placeholder="message" className="message"/>
                <input className="submitbutton" type="button" value="Submit" />
             </div>
        )
    }
}
